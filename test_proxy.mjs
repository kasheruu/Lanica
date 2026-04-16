async function run() {
  let glbUrl =
    "https://assets.meshy.ai/1acf500d-9678-43a7-b6ed-0175dae9bd35/tasks/019d18b9-a247-74f0-a407-b024b23546ae/mesh.glb?Signature=BfK3Yy4K2Zc5-wZ1P9U7bVQV3Yh4w1xSfs12n-qQ0R7p8-q~hY8y9pGvM7TfO5oGj3vL~pL4tU6XqA5X~G-y6T3sY3G5Z0QxQ9Y6F1l2xZ0F-sTzZzJ3C-tK2eK2gX1wG1rG5iR5m~uA7h~pI8g0Y~G-vK1kQ3nJ0vD3lO1uM~R3j~xU2W2zD4zD1yF3qR8lP3wW1oQ5kL9bF6sF9aO4z~tR4lC6vW3rE3X6yA~xY4vL~pH7tF~vK3gN9xN7jT8mR1eE5lP5aQ5lN8fB2zH6oU~pB~yN2l~tK7xT6eH7lN5sN8zM~&Key-Pair-Id=KL5I0C8H7HX83";

  // Test codetabs
  let codeTabs = `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(glbUrl)}`;
  let res = await fetch(codeTabs);
  console.log("Codetabs status:", res.status);
}
run();
