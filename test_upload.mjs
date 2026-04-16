async function testUpload() {
  try {
    const formData = new FormData();
    const blob = new Blob(["dummy test content"], { type: "text/plain" });
    formData.append("file", blob, "test.txt");
    formData.append("upload_preset", "ml_lanica");
    formData.append("folder", "lanica_products");

    console.log("Sending request to Cloudinary...");
    const res = await fetch("https://api.cloudinary.com/v1_1/daoz8m2oh/auto/upload", {
      method: "POST",
      body: formData,
    });

    console.log("Response Status:", res.status);
    console.log("Response Body:", await res.text());
  } catch (err) {
    console.error("Error:", err);
  }
}
testUpload();
