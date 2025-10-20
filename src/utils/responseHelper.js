export const successResponse = (data = {}) => ({
    success: true,
    ...data
});

export const errorResponse = (error, status = 400) => ({
    success: false,
    error,
    status
});

export const validationError = (message) =>
    errorResponse(message, 400);
