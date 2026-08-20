import { api } from './api';

export interface VisitorSearchParams {
    search?: string;
    status?: 'EXPECTED' | 'CHECKED_IN';
    page?: number;
    limit?: number;
}

export const visitorsApi = {
    // Visitors CRUD
    getAllActive: async (params?: VisitorSearchParams) => {
        const response = await api.get('/visitors/active', { params });
        return response.data;
    },

    createWalkIn: async (data: any) => {
        const response = await api.post('/visitors', data);
        return response.data;
    },

    checkIn: async (visitorId: string, credentialType: string, credentialValue: string) => {
        const response = await api.post(`/visitors/${visitorId}/check-in`, { credentialType, credentialValue });
        return response.data;
    },

    checkOut: async (visitorId: string) => {
        const response = await api.post(`/visitors/${visitorId}/check-out`);
        return response.data;
    },

    // Remote Pre-Registration
    generatePreRegistrationToken: async (visitData: any) => {
        const response = await api.post('/pre-registration/generate', visitData);
        return response.data;
    },

    completePreRegistration: async (token: string, data: any) => {
        // This is public, should probably not require the bearer token but the interceptor is fine
        // as it ignores 401 for this specific case contextually if handled properly.
        const response = await api.post(`/pre-registration/${token}/complete`, data);
        return response.data;
    }
};
