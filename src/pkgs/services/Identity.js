const pkg = {
  name: "Encore Identity Service",
  svcName: "IdentitySvc",
  type: "svc",
  privs: 0,
  start: async function (Root) {
    this.root = Root;

    const config = await window.config.getAll();
    this.data.profile = {
      nickname: config.identityConfig?.nickname || "",
      avatar: config.identityConfig?.avatar || null,
    };

    console.log("[IDENTITY] Identity Service started.");
  },
  end: async function () {
    console.log("[IDENTITY] Identity Service shutting down.");
  },
  data: {
    profile: {
      nickname: "",
      avatar: null,
    },

    /**
     * Retrieves the current user profile.
     */
    getProfile: function () {
      return this.profile;
    },

    /**
     * Updates the local profile and saves it to the config file.
     * @param {string} nickname
     * @param {string|null} base64Avatar
     */
    updateProfile: async function (nickname, base64Avatar) {
      this.profile.nickname = nickname.trim() || "Singer";
      if (base64Avatar !== undefined) {
        this.profile.avatar = base64Avatar;
      }

      if (window.config && typeof window.config.setItem === "function") {
        await window.config.setItem("identityConfig", this.profile);
      }
    },

    /**
     * Takes an image file, paints it to a hidden canvas, and scales it down.
     * This keeps the WebRTC metadata payload tiny (vital for fast connections).
     * @param {File} file
     * @returns {Promise<string>} Base64 JPEG data URL
     */
    processAvatarFile: function (file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement("canvas");
            const ctx = canvas.getContext("2d");

            const SIZE = 256;
            canvas.width = SIZE;
            canvas.height = SIZE;

            const scale = Math.max(SIZE / img.width, SIZE / img.height);
            const w = img.width * scale;
            const h = img.height * scale;
            const x = (SIZE - w) / 2;
            const y = (SIZE - h) / 2;

            ctx.fillStyle = "#333";
            ctx.fillRect(0, 0, SIZE, SIZE);
            ctx.drawImage(img, x, y, w, h);

            resolve(canvas.toDataURL("image/jpeg", 0.6));
          };
          img.onerror = reject;
          img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    },

    /**
     * Resolves a name collision. If "Singer" exists, returns "Singer 1", etc.
     * @param {string} desiredName
     * @param {string[]} existingNames
     * @returns {string} A guaranteed unique name
     */
    resolveCollision: function (desiredName, existingNames) {
      let baseName = desiredName.trim().substring(0, 15) || "Singer";
      let finalName = baseName;
      let counter = 1;

      const lowerExisting = existingNames.map((n) => n.toLowerCase());

      while (lowerExisting.includes(finalName.toLowerCase())) {
        finalName = `${baseName}#${counter}`;
        counter++;
      }
      return finalName;
    },
  },
};
export default pkg;
