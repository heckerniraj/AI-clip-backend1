const axios = require('axios');

// Export a standard axios instance without proxy
const axiosInstance = axios.create();

module.exports = {
  axiosWithProxy: axiosInstance, // Keep the name for backward compatibility
  axiosDefault: axios,
  createAxiosInstance: () => {
    return axiosInstance; // Always return the standard instance
  }
}; 