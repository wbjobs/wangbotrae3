module.exports = {
  id: 'dns',
  name: 'DNS Protocol',
  description: 'Parses DNS queries and responses on port 53',
  version: '1.0.0',
  author: 'Pcap Analyzer',
  ports: [53],
  protocols: ['UDP', 'TCP'],
  parse: (ctx) => {
    if (!ctx.payload || ctx.payload.length < 12) return null;
    const dns = ctx.utils.parseDns(ctx.payload);
    if (!dns) return null;
    return {
      protocol: 'DNS',
      ...dns,
      queryCount: dns.counts.qdcount,
      answerCount: dns.counts.ancount,
      firstQuery: dns.questions.length > 0 ? dns.questions[0].name : null
    };
  }
};
