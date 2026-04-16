const FormData = require("form-data");
async function run() {
  // A known completed meshy task ID GLB URL
  const meshyUrl = "https://modelviewer.dev/shared-assets/models/Astronaut.glb"; // Generic public GLB
  const fd = new FormData();
  fd.append("file", meshyUrl);
  fd.append("upload_preset", "ml_lanica");

  // For raw files like .glb, sometimes we need resource_type="raw" or "auto"
  // The standard endpoint is /image/upload, but /auto/upload or /raw/upload works for everything.
  const url = `https://api.cloudinary.com/v1_1/daoz8m2oh/auto/upload`;

  const res = await fetch(url, {
    method: "POST",
    body: fd,
  });
  console.log("Status:", res.status);
  console.log(await res.text());
}
run();
