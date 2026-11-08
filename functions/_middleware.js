// CF Pages 中间件：给所有 HTML 响应自动注入 loading.css 和 loading.js，无需逐页引用
export async function onRequest(context) {
  const response = await context.next();
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return response;

  const rewriter = new HTMLRewriter()
    .on('head', {
      element(el) {
        el.append('<link rel="stylesheet" href="/loading.css">', { html: true });
      }
    })
    .on('body', {
      element(el) {
        el.append('<script src="/loading.js"></' + 'script>', { html: true });
      }
    });

  return rewriter.transform(response);
}
