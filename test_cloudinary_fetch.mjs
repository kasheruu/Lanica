async function run() {
  const meshyKey = "msy_MjNcfrt0xvjdoYRrI843GqmvI0yFDNe9dZfH";
  let statusRes = await fetch(
    `https://api.meshy.ai/v1/image-to-3d/019d18b9-a247-74f0-a407-b024b23546ae`,
    {
      headers: { Authorization: `Bearer ${meshyKey}` },
    }
  );
  let statusData = await statusRes.json();
  let glbUrl = statusData.model_urls.glb;

  const fd = new FormData();
  fd.append("file", glbUrl);
  fd.append("upload_preset", "ml_lanica");

  // Force resource_type=video
  let uploadRes = await fetch(`https://api.cloudinary.com/v1_1/daoz8m2oh/video/upload`, {
    method: "POST",
    body: fd,
  });

  console.log("Cloudinary Upload Status:", uploadRes.status);
  console.log(await uploadRes.text());
}
run();
