module.exports = {
  id: 'modbus',
  name: 'Modbus/TCP',
  description: 'Parses Modbus/TCP protocol on port 502',
  version: '1.0.0',
  author: 'Pcap Analyzer',
  ports: [502],
  protocols: ['TCP'],
  filter: (pkt) => pkt.payloadLength >= 7,
  parse: (ctx) => {
    const payload = ctx.payload;
    if (!payload || payload.length < 7) return null;

    const transactionId = payload.readUInt16BE(0);
    const protocolId = payload.readUInt16BE(2);
    if (protocolId !== 0) return null;

    const length = payload.readUInt16BE(4);
    const unitId = payload[6];
    const functionCode = payload[7];

    const functionNames = {
      1: 'Read Coils',
      2: 'Read Discrete Inputs',
      3: 'Read Holding Registers',
      4: 'Read Input Registers',
      5: 'Write Single Coil',
      6: 'Write Single Register',
      15: 'Write Multiple Coils',
      16: 'Write Multiple Registers'
    };

    const isException = functionCode > 0x80;
    const actualFunction = isException ? functionCode - 0x80 : functionCode;

    let parsedData = {};
    let dataStart = 8;

    if (length >= 2 && payload.length >= 8 + (length - 1)) {
      if (functionCode === 3 || functionCode === 4) {
        if (payload.length >= 13) {
          parsedData.startingAddress = payload.readUInt16BE(8);
          parsedData.quantity = payload.readUInt16BE(10);
        }
      } else if (functionCode === 6) {
        if (payload.length >= 13) {
          parsedData.address = payload.readUInt16BE(8);
          parsedData.value = payload.readUInt16BE(10);
        }
      } else if (isException && payload.length >= 9) {
        parsedData.exceptionCode = payload[8];
        const exceptions = {
          1: 'Illegal Function',
          2: 'Illegal Data Address',
          3: 'Illegal Data Value',
          4: 'Server Device Failure',
          5: 'Acknowledge',
          6: 'Server Device Busy'
        };
        parsedData.exceptionMessage = exceptions[parsedData.exceptionCode] || 'Unknown';
      }
    }

    return {
      protocol: 'Modbus/TCP',
      transactionId,
      protocolId,
      unitId,
      functionCode,
      functionName: functionNames[actualFunction] || `Unknown (${actualFunction})`,
      isException,
      ...parsedData,
      rawData: payload.slice(7, 7 + (length - 1)).toString('hex')
    };
  }
};
