module.exports = {
  id: 'http',
  name: 'HTTP Protocol',
  description: 'Parses HTTP requests and responses on ports 80, 8080, 3000, 443',
  version: '1.0.0',
  author: 'Pcap Analyzer',
  ports: [80, 8080, 3000, 443],
  protocols: ['TCP'],
  filter: (pkt) => pkt.payloadLength > 0,
  parse: (ctx) => {
    if (!ctx.payload || ctx.payload.length < 4) return null;
    const payload = ctx.payload;

    const firstByte = payload[0];
    const isText = (firstByte >= 32 && firstByte <= 126) || firstByte === 10 || firstByte === 13;
    if (!isText) return null;

    const http = ctx.utils.parseHttp(payload);
    if (!http) return null;

    return {
      protocol: 'HTTP',
      ...http,
      contentType: http.headers ? http.headers['Content-Type'] || http.headers['content-type'] : null,
      host: http.headers ? http.headers['Host'] || http.headers['host'] : null,
      userAgent: http.headers ? http.headers['User-Agent'] || http.headers['user-agent'] : null,
      contentLength: http.headers ? parseInt(http.headers['Content-Length'] || http.headers['content-length'] || '0') : 0
    };
  }
};
