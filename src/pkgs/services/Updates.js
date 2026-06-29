const pkg = {
  name: "Encore Update Checker Service",
  svcName: "UpdateSvc",
  type: "svc",
  privs: 0,
  start: async function (Root) {
    this.root = Root;
    console.log("[UPDATE] Update Service started.");
  },
  end: async function () {
    console.log("[UPDATE] Update Service shutting down.");
  },
  data: {
    getUpdateInformation: function () {
      return {};
    },
  },
};
export default pkg;
