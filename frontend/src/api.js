export async function api(path, options = {}) {
  const response = await fetch("/api" + path, {
    ...options,
    headers:
      options.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(
      typeof body.detail === "string"
        ? body.detail
        : `请求失败 (${response.status})`,
    );
  }
  return response.json();
}
export const post = (path, body = {}) =>
  api(path, { method: "POST", body: JSON.stringify(body) });
export const download = (url) => {
  const a = document.createElement("a");
  a.href = url;
  a.download = "";
  a.click();
};
