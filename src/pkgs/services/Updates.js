let versioningEndpoint = "https://versioning.encorekaraoke.org/versionInfo";
let updateInformation = null;
let config = null;

const pkg = {
  name: "Encore Update Checker Service",
  svcName: "UpdateSvc",
  type: "svc",
  privs: 0,
  start: async function (Root) {
    this.root = Root;
    config = await window.config.getAll();
    fetch(versioningEndpoint)
      .then((res) => res.json())
      .then((data) => {
        this.updateInformation = data;
        console.log(
          "[UPDATE] Fetched update information",
          this.updateInformation,
        );
      });
    console.log("[UPDATE] Update Service started.");
  },
  end: async function () {
    console.log("[UPDATE] Update Service shutting down.");
  },
  data: {
    getUpdateInformation: function () {
      return updateInformation;
    },
    refreshUpdateInformation: async function () {
      let res = await fetch(versioningEndpoint);
      updateInformation = await res.json();
    },
  },
};
export default pkg;
