const NetworkingUtility = {
  async getPort() {
    return await window.networking.port();
  },
  async getAccessToken() {
    return await window.networking.accessToken();
  },
  async getFileLink(path) {
    const port = await this.getPort();
    const token = await this.getAccessToken();
    const url = new URL(`http://127.0.0.1:${port}/getFile`);
    url.searchParams.append("token", token);
    url.searchParams.append("path", path);
    return url;
  },
};

export default NetworkingUtility;
