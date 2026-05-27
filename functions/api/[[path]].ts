export async function onRequest(context: any) {
  const url = new URL(context.request.url);
  const targetUrl = `https://pos-worker.mangowarrior-pos.workers.dev${url.pathname}${url.search}`;
  
  return fetch(targetUrl, {
    method: context.request.method,
    headers: context.request.headers,
    body: context.request.body,
  });
}