async function run() {
  const fd = new FormData();
  // Test URL upload using ml_lanica
  fd.append("file", "https://upload.wikimedia.org/wikipedia/commons/a/a2/Test_image.png");
  fd.append("upload_preset", "ml_lanica");

  const res = await fetch(`https://api.cloudinary.com/v1_1/daoz8m2oh/auto/upload`, {
    method: "POST",
    body: fd,
  });
  console.log(res.status);
  console.log(await res.text());
}
run();
