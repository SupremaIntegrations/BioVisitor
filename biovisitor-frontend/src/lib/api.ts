import axios from 'axios';

/**
 * Cliente de API centralizado para el Frontend.
 * Configura la URL base y los interceptores para inyectar el token JWT.
 */

export const api = axios.create({
    // Por defecto, asume que el backend corre localmente en el puerto 3001 (NestJS)
    baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1',
    headers: {
        'Content-Type': 'application/json',
    },
});

// Interceptor para inyectar el Token en cada petición
api.interceptors.request.use(
    (config) => {
        // Solo se ejecuta en el cliente (Browser)
        if (typeof window !== 'undefined') {
            const token = localStorage.getItem('biovisitor_token');
            if (token && config.headers) {
                config.headers.Authorization = `Bearer ${token}`;
            }
        }
        return config;
    },
    (error) => Promise.reject(error)
);

// Interceptor para manejar errores comunes (ej: 401 Unauthorized)
api.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response?.status === 401) {
            if (typeof window !== 'undefined') {
                localStorage.removeItem('biovisitor_token');
                localStorage.removeItem('biovisitor_user');
                // Redirigir al login si el token expira o es inválido
                if (window.location.pathname !== '/') {
                    window.location.href = '/';
                }
            }
        }
        return Promise.reject(error);
    }
);
