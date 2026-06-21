const NetworkingUtility = {
  async getPort() {
    return await window.networking.port();
  },
  async getAccessToken() {
    return await window.networking.accessToken();
  },
};

export default NetworkingUtility;
