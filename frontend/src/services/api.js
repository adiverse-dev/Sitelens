/**
 * Centralized API configuration.
 * Do not hardcode localhost:5000 directly.
 */
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

/**
 * Standard fetch wrapper that throws on HTTP errors.
 */
export async function apiFetch(endpoint, options = {}) {
  const url = `${API_BASE_URL}${endpoint}`;
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (!response.ok) {
      // Attempt to extract the error message from the backend response
      let errorMessage = `HTTP Error ${response.status}`;
      try {
        const errData = await response.json();
        if (errData.error) {
          errorMessage = errData.error;
        }
      } catch (e) {
        // If it's not JSON or fails to parse, keep the generic error message
      }
      throw new Error(errorMessage);
    }

    return await response.json();
  } catch (error) {
    throw error;
  }
}
