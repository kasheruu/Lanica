async function run() {
  console.log("Starting...");
  let statusRes = await fetch(
    `https://api.meshy.ai/v1/image-to-3d/019d18b9-a247-74f0-a407-b024b23546ae`,
    {
      headers: { Authorization: `Bearer msy_MjNcfrt0xvjdoYRrI843GqmvI0yFDNe9dZfH` },
    }
  );
  let statusData = await statusRes.json();
  let glbUrl = statusData.model_urls.glb;

  console.log("Fetching GLB...", glbUrl.substring(0, 50));
  let glbRes = await fetch(glbUrl);
  let glbBuffer = await glbRes.arrayBuffer();
  console.log("Downloaded GLB size:", glbBuffer.byteLength);

  const chunkSize = 5 * 1024 * 1024;
  const totalSize = glbBuffer.byteLength;
  const uploadId = "chunked_upload_" + Date.now();
  let secureUrl = null;

  for (let start = 0; start < totalSize; start += chunkSize) {
    let end = start + chunkSize - 1;
    if (end >= totalSize) end = totalSize - 1;

    const chunk = glbBuffer.slice(start, end + 1);
    const chunkBlob = new Blob([chunk]);

    const fd = new FormData();
    fd.append("file", chunkBlob, "model.glb");
    fd.append("upload_preset", "ml_lanica");

    console.log(`Uploading ${start}-${end}...`);
    let res = await fetch(`https://api.cloudinary.com/v1_1/daoz8m2oh/auto/upload`, {
      method: "POST",
      headers: {
        "X-Unique-Upload-Id": uploadId,
        "Content-Range": `bytes ${start}-${end}/${totalSize}`,
      },
      body: fd,
    });

    console.log(`Chunk Status:`, res.status);
    let text = await res.text();
    if (res.status === 200 || res.status === 201) {
      let data = JSON.parse(text);
      if (data.secure_url) secureUrl = data.secure_url;
    } else {
      console.log("Error:", text.substring(0, 100));
    }
  }
  console.log("FINAL URL:", secureUrl);
}
run();
