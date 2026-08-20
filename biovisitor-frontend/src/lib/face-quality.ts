'use client';

import type * as faceapiType from 'face-api.js';

let faceapi: typeof faceapiType | null = null;
let modelsLoaded = false;
let loadingPromise: Promise<void> | null = null;

export async function ensureFaceApiLoaded(): Promise<typeof faceapiType> {
  if (faceapi && modelsLoaded) return faceapi;

  if (loadingPromise) {
    await loadingPromise;
    return faceapi!;
  }

  loadingPromise = (async () => {
    faceapi = await import('face-api.js');
    await Promise.all([
      faceapi.nets.ssdMobilenetv1.loadFromUri('/models'),
      faceapi.nets.faceLandmark68Net.loadFromUri('/models'),
      faceapi.nets.faceExpressionNet.loadFromUri('/models'),
    ]);
    modelsLoaded = true;
  })();

  await loadingPromise;
  return faceapi!;
}

export interface FaceQualityIssue {
  code: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface FaceBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FaceQualityResult {
  passed: boolean;
  issues: FaceQualityIssue[];
  summary: string;
  faceBox?: FaceBox;
}

const THRESHOLDS = {
  MIN_FACE_RATIO: 0.06,
  MAX_YAW_DEGREES: 20,
  MAX_PITCH_DEGREES: 15,
  EAR_CLOSED: 0.19,
  MAX_EXPRESSION_SCORE: 0.6,
  CENTERING_TOLERANCE: 0.28,
  FOREHEAD_VISIBLE_RATIO: 0.10,
  SYMMETRY_TOLERANCE: 0.40,
};

function euclidean(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function calculateEAR(eye: { x: number; y: number }[]): number {
  const v1 = euclidean(eye[1], eye[5]);
  const v2 = euclidean(eye[2], eye[4]);
  const h = euclidean(eye[0], eye[3]);
  if (h === 0) return 0;
  return (v1 + v2) / (2 * h);
}

function estimateYaw(landmarks: faceapiType.FaceLandmarks68): number {
  const nose = landmarks.getNose();
  const leftEye = landmarks.getLeftEye();
  const rightEye = landmarks.getRightEye();
  const jaw = landmarks.getJawOutline();

  const noseTip = nose[3];
  const leftEyeCenter = {
    x: leftEye.reduce((s, p) => s + p.x, 0) / leftEye.length,
    y: leftEye.reduce((s, p) => s + p.y, 0) / leftEye.length,
  };
  const rightEyeCenter = {
    x: rightEye.reduce((s, p) => s + p.x, 0) / rightEye.length,
    y: rightEye.reduce((s, p) => s + p.y, 0) / rightEye.length,
  };

  const eyeMidpoint = {
    x: (leftEyeCenter.x + rightEyeCenter.x) / 2,
    y: (leftEyeCenter.y + rightEyeCenter.y) / 2,
  };

  const eyeWidth = euclidean(leftEyeCenter, rightEyeCenter);
  if (eyeWidth === 0) return 90;

  const noseOffset = (noseTip.x - eyeMidpoint.x) / eyeWidth;

  const leftJawDist = euclidean(jaw[0], noseTip);
  const rightJawDist = euclidean(jaw[16], noseTip);
  const jawRatio = leftJawDist / (rightJawDist + 0.001);

  const combinedOffset = noseOffset * 0.6 + (jawRatio - 1) * 0.4;
  const yawDeg = combinedOffset * 60;

  return yawDeg;
}

function estimatePitch(landmarks: faceapiType.FaceLandmarks68): number {
  const nose = landmarks.getNose();
  const leftEye = landmarks.getLeftEye();
  const rightEye = landmarks.getRightEye();
  const mouth = landmarks.getMouth();

  const eyeCenter = {
    x: (leftEye[0].x + rightEye[3].x) / 2,
    y: (leftEye[0].y + rightEye[3].y) / 2,
  };
  const noseTip = nose[3];
  const mouthCenter = {
    x: (mouth[0].x + mouth[6].x) / 2,
    y: (mouth[0].y + mouth[6].y) / 2,
  };

  const faceHeight = euclidean(eyeCenter, mouthCenter);
  if (faceHeight === 0) return 0;

  const noseToEyeRatio = (noseTip.y - eyeCenter.y) / faceHeight;
  const expectedRatio = 0.45;
  const deviation = noseToEyeRatio - expectedRatio;

  return deviation * 80;
}

function checkForeheadVisible(
  landmarks: faceapiType.FaceLandmarks68,
  faceBox: { x: number; y: number; width: number; height: number }
): boolean {
  const leftBrow = landmarks.getLeftEyeBrow();
  const rightBrow = landmarks.getRightEyeBrow();

  const browTopY = Math.min(
    ...leftBrow.map(p => p.y),
    ...rightBrow.map(p => p.y)
  );

  const foreheadSpace = browTopY - faceBox.y;
  const faceHeight = faceBox.height;

  return (foreheadSpace / faceHeight) >= THRESHOLDS.FOREHEAD_VISIBLE_RATIO;
}

function checkFacialSymmetry(landmarks: faceapiType.FaceLandmarks68): number {
  const nose = landmarks.getNose();
  const leftEye = landmarks.getLeftEye();
  const rightEye = landmarks.getRightEye();
  const jaw = landmarks.getJawOutline();

  const noseLine = nose[3].x;

  const leftEyeDist = Math.abs(noseLine - leftEye[0].x);
  const rightEyeDist = Math.abs(rightEye[3].x - noseLine);

  const leftJawDist = Math.abs(noseLine - jaw[2].x);
  const rightJawDist = Math.abs(jaw[14].x - noseLine);

  const eyeSymmetry = Math.abs(leftEyeDist - rightEyeDist) / (leftEyeDist + rightEyeDist + 0.001);
  const jawSymmetry = Math.abs(leftJawDist - rightJawDist) / (leftJawDist + rightJawDist + 0.001);

  return (eyeSymmetry + jawSymmetry) / 2;
}

export async function analyzeFaceQuality(imageDataUrl: string): Promise<FaceQualityResult> {
  const faceapi = await ensureFaceApiLoaded();
  const issues: FaceQualityIssue[] = [];

  const img = new Image();
  img.src = imageDataUrl;
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Failed to load image'));
  });

  const allDetections = await faceapi
    .detectAllFaces(img, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.35 }))
    .withFaceLandmarks()
    .withFaceExpressions();

  if (allDetections.length === 0) {
    return {
      passed: false,
      issues: [{
        code: 'NO_FACE',
        message: 'No se detectó ningún rostro. Posicione su cara dentro del óvalo guía, asegúrese de tener buena iluminación y mire directamente a la cámara.',
        severity: 'error',
      }],
      summary: 'No se detectó ningún rostro',
    };
  }

  if (allDetections.length > 1) {
    issues.push({
      code: 'MULTIPLE_FACES',
      message: 'Se detectaron múltiples personas. Solo el visitante debe estar visible en el encuadre (requisito Suprema BioStar).',
      severity: 'error',
    });
  }

  const detection = allDetections.reduce((best, d) =>
    d.detection.score > best.detection.score ? d : best
  , allDetections[0]);

  const box = detection.detection.box;
  const imageArea = img.width * img.height;
  const faceArea = box.width * box.height;

  if (faceArea / imageArea < THRESHOLDS.MIN_FACE_RATIO) {
    issues.push({
      code: 'FACE_TOO_SMALL',
      message: 'El rostro es muy pequeño. Acérquese a la cámara. La distancia ideal es entre 60 y 100 cm.',
      severity: 'error',
    });
  }

  const landmarks = detection.landmarks;

  const yaw = estimateYaw(landmarks);
  if (Math.abs(yaw) > THRESHOLDS.MAX_YAW_DEGREES) {
    const direction = yaw > 0 ? 'derecha' : 'izquierda';
    issues.push({
      code: 'HEAD_TURNED',
      message: `La cabeza está girada demasiado hacia la ${direction}. Mire directamente a la cámara de frente (requisito Suprema BioStar).`,
      severity: 'error',
    });
  }

  const pitch = estimatePitch(landmarks);
  if (Math.abs(pitch) > THRESHOLDS.MAX_PITCH_DEGREES) {
    const direction = pitch > 0 ? 'abajo' : 'arriba';
    issues.push({
      code: 'HEAD_TILTED',
      message: `La cabeza está inclinada hacia ${direction}. No incline la cabeza; mire directamente a la cámara.`,
      severity: 'error',
    });
  }

  const leftEye = landmarks.getLeftEye();
  const rightEye = landmarks.getRightEye();
  const leftEAR = calculateEAR(leftEye);
  const rightEAR = calculateEAR(rightEye);
  const avgEAR = (leftEAR + rightEAR) / 2;

  if (avgEAR < THRESHOLDS.EAR_CLOSED) {
    issues.push({
      code: 'EYES_CLOSED',
      message: 'Los ojos parecen estar cerrados. Mantenga ambos ojos completamente abiertos durante la captura (requisito Suprema BioStar).',
      severity: 'error',
    });
  }

  const expressions = detection.expressions;
  const expressionEntries = Object.entries(expressions) as [string, number][];
  const dominant = expressionEntries.reduce((a, b) => b[1] > a[1] ? b : a);

  if (dominant[0] !== 'neutral' && dominant[1] > THRESHOLDS.MAX_EXPRESSION_SCORE) {
    const exprMap: Record<string, string> = {
      happy: 'sonriendo',
      angry: 'con expresión de enojo',
      sad: 'con expresión de tristeza',
      disgusted: 'con expresión de disgusto',
      surprised: 'con expresión de sorpresa',
      fearful: 'con expresión de miedo',
    };
    const desc = exprMap[dominant[0]] || `con expresión ${dominant[0]}`;
    issues.push({
      code: 'EXPRESSION_NOT_NEUTRAL',
      message: `Su expresión no es neutra (aparece ${desc}). Mantenga una expresión relajada y neutra (requisito Suprema BioStar).`,
      severity: 'error',
    });
  }

  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  const imgCenterX = img.width / 2;
  const imgCenterY = img.height / 2;
  const offsetX = Math.abs(centerX - imgCenterX) / img.width;
  const offsetY = Math.abs(centerY - imgCenterY) / img.height;

  if (offsetX > THRESHOLDS.CENTERING_TOLERANCE || offsetY > THRESHOLDS.CENTERING_TOLERANCE) {
    issues.push({
      code: 'FACE_OFF_CENTER',
      message: 'El rostro no está centrado. Posicione su cara dentro del óvalo guía con ambos hombros visibles.',
      severity: 'error',
    });
  }

  if (!checkForeheadVisible(landmarks, box)) {
    issues.push({
      code: 'FOREHEAD_HIDDEN',
      message: 'La frente no es visible. Retire gorros, gorras o accesorios que cubran el rostro (requisito Suprema BioStar: sin gorros, máscaras ni accesorios).',
      severity: 'error',
    });
  }

  const asymmetry = checkFacialSymmetry(landmarks);
  if (asymmetry > THRESHOLDS.SYMMETRY_TOLERANCE) {
    if (!issues.some(i => i.code === 'HEAD_TURNED')) {
      issues.push({
        code: 'FACE_ASYMMETRIC',
        message: 'El rostro no está completamente de frente. Mire directamente a la cámara sin girar ni inclinar la cabeza.',
        severity: 'error',
      });
    }
  }

  try {
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const sx = Math.max(0, Math.floor(box.x));
    const sy = Math.max(0, Math.floor(box.y));
    const sw = Math.min(Math.floor(box.width), img.width - sx);
    const sh = Math.min(Math.floor(box.height), img.height - sy);
    if (sw > 0 && sh > 0) {
      const faceRegion = ctx.getImageData(sx, sy, sw, sh);
      const pixels = faceRegion.data;
      let totalBrightness = 0;
      const pixelCount = pixels.length / 4;
      for (let i = 0; i < pixels.length; i += 4) {
        totalBrightness += (pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114);
      }
      const avgBrightness = totalBrightness / pixelCount;

      if (avgBrightness < 40) {
        issues.push({
          code: 'TOO_DARK',
          message: 'La imagen es muy oscura. Asegúrese de tener iluminación uniforme sobre el rostro (evite lugares oscuros con luces parpadeantes).',
          severity: 'error',
        });
      } else if (avgBrightness > 230) {
        issues.push({
          code: 'TOO_BRIGHT',
          message: 'La imagen está sobreexpuesta. Reduzca la iluminación directa o aléjese de la fuente de luz.',
          severity: 'error',
        });
      }
    }
  } catch {
  }

  const errorIssues = issues.filter(i => i.severity === 'error');
  const passed = errorIssues.length === 0;

  let summary: string;
  if (passed) {
    summary = 'Todas las verificaciones de calidad aprobadas';
  } else if (errorIssues.length === 1) {
    summary = errorIssues[0].message;
  } else {
    summary = `${errorIssues.length} problemas encontrados — por favor retome la foto`;
  }

  const faceBox: FaceBox = {
    x: Math.round(box.x),
    y: Math.round(box.y),
    width: Math.round(box.width),
    height: Math.round(box.height),
  };

  return { passed, issues, summary, faceBox };
}

/**
 * Detects a face in an image and returns its bounding box.
 * Used for camera captures that skip the full quality pipeline.
 * Returns null if no face is detected.
 */
export async function detectFaceBox(imageDataUrl: string): Promise<FaceBox | null> {
  try {
    const faceapi = await ensureFaceApiLoaded();
    const img = new Image();
    img.src = imageDataUrl;
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Failed to load image'));
    });

    const detections = await faceapi
      .detectAllFaces(img, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.35 }));

    if (detections.length === 0) return null;

    const best = detections.reduce((a, b) => b.score > a.score ? b : a);
    const box = best.box;
    return {
      x: Math.round(box.x),
      y: Math.round(box.y),
      width: Math.round(box.width),
      height: Math.round(box.height),
    };
  } catch {
    return null;
  }
}
