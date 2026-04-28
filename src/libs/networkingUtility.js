const NetworkingUtility = {
  async getPort() {
    return await window.networking.port();
  },
};

export default NetworkingUtility;
