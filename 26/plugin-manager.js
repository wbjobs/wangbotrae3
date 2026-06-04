const fs = require('fs');
const path = require('path');

class PluginManager {
  constructor() {
    this.plugins = new Map();
    this.portMappings = new Map();
    this.protocolMappings = new Map();
    this.builtinPluginsDir = path.join(__dirname, 'plugins');
    this.userPluginsDir = null;
  }

  setUserPluginsDir(dir) {
    this.userPluginsDir = dir;
  }

  loadBuiltinPlugins() {
    if (!fs.existsSync(this.builtinPluginsDir)) return [];
    const files = fs.readdirSync(this.builtinPluginsDir).filter(f => f.endsWith('.js'));
    const loaded = [];
    for (const file of files) {
      try {
        const pluginPath = path.join(this.builtinPluginsDir, file);
        const result = this.loadPlugin(pluginPath);
        if (result.success) loaded.push(result.plugin);
      } catch (e) {
        console.error('Failed to load builtin plugin', file, e.message);
      }
    }
    return loaded;
  }

  loadUserPlugins() {
    if (!this.userPluginsDir || !fs.existsSync(this.userPluginsDir)) return [];
    const files = fs.readdirSync(this.userPluginsDir).filter(f => f.endsWith('.js'));
    const loaded = [];
    for (const file of files) {
      try {
        const pluginPath = path.join(this.userPluginsDir, file);
        const result = this.loadPlugin(pluginPath);
        if (result.success) loaded.push(result.plugin);
      } catch (e) {
        console.error('Failed to load user plugin', file, e.message);
      }
    }
    return loaded;
  }

  loadPlugin(pluginPath) {
    try {
      const fullPath = path.resolve(pluginPath);
      if (this.plugins.has(fullPath)) {
        return { success: false, error: 'Plugin already loaded' };
      }

      delete require.cache[fullPath];
      const pluginDef = require(fullPath);

      if (!pluginDef.name || !pluginDef.parse) {
        return { success: false, error: 'Invalid plugin: must have name and parse function' };
      }

      const plugin = {
        id: pluginDef.id || pluginDef.name.toLowerCase().replace(/\s+/g, '-'),
        name: pluginDef.name,
        description: pluginDef.description || '',
        version: pluginDef.version || '1.0.0',
        author: pluginDef.author || '',
        ports: pluginDef.ports || [],
        protocols: pluginDef.protocols || ['TCP', 'UDP'],
        filter: pluginDef.filter || null,
        parse: pluginDef.parse,
        path: fullPath,
        enabled: true
      };

      this.plugins.set(fullPath, plugin);

      for (const port of plugin.ports) {
        if (!this.portMappings.has(port)) this.portMappings.set(port, []);
        this.portMappings.get(port).push(plugin);
      }

      for (const proto of plugin.protocols) {
        if (!this.protocolMappings.has(proto)) this.protocolMappings.set(proto, []);
        this.protocolMappings.get(proto).push(plugin);
      }

      return { success: true, plugin: this.serializePlugin(plugin) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  unloadPlugin(pluginId) {
    for (const [path, plugin] of this.plugins) {
      if (plugin.id === pluginId) {
        for (const port of plugin.ports) {
          const arr = this.portMappings.get(port);
          if (arr) {
            const idx = arr.indexOf(plugin);
            if (idx > -1) arr.splice(idx, 1);
          }
        }
        for (const proto of plugin.protocols) {
          const arr = this.protocolMappings.get(proto);
          if (arr) {
            const idx = arr.indexOf(plugin);
            if (idx > -1) arr.splice(idx, 1);
          }
        }
        this.plugins.delete(path);
        delete require.cache[path];
        return { success: true };
      }
    }
    return { success: false, error: 'Plugin not found' };
  }

  getMatchingPlugins(packetInfo) {
    const matches = [];
    const { srcPort, dstPort, protocol } = packetInfo;

    const portMatch = this.portMappings.get(srcPort) || this.portMappings.get(dstPort);
    const protoMatch = this.protocolMappings.get(protocol);

    const candidates = new Set();
    if (portMatch) portMatch.forEach(p => candidates.add(p));
    if (protoMatch) protoMatch.forEach(p => candidates.add(p));

    for (const plugin of candidates) {
      if (!plugin.enabled) continue;
      if (plugin.filter && !plugin.filter(packetInfo)) continue;
      matches.push(plugin);
    }

    return matches;
  }

  runPlugins(packetInfo, payloadBuffer, rawPacketBuffer) {
    const plugins = this.getMatchingPlugins(packetInfo);
    if (plugins.length === 0) return null;

    const results = {};
    for (const plugin of plugins) {
      try {
        const result = plugin.parse({
          ...packetInfo,
          payload: payloadBuffer,
          rawPacket: rawPacketBuffer,
          utils: {
            readString: (buf, offset, maxLen) => {
              const end = Math.min(offset + maxLen, buf.length);
              let str = '';
              for (let i = offset; i < end; i++) {
                if (buf[i] === 0) break;
                str += String.fromCharCode(buf[i]);
              }
              return str;
            },
            toHex: (buf) => buf.toString('hex'),
            parseHttp: parseHttp,
            parseDns: parseDns
          }
        });
        if (result) {
          results[plugin.id] = {
            pluginName: plugin.name,
            pluginVersion: plugin.version,
            ...result
          };
        }
      } catch (err) {
        results[plugin.id] = {
          pluginName: plugin.name,
          error: err.message
        };
      }
    }

    return Object.keys(results).length > 0 ? results : null;
  }

  getPlugin(id) {
    for (const plugin of this.plugins.values()) {
      if (plugin.id === id) return this.serializePlugin(plugin);
    }
    return null;
  }

  listPlugins() {
    return Array.from(this.plugins.values()).map(p => this.serializePlugin(p));
  }

  setPluginEnabled(id, enabled) {
    for (const plugin of this.plugins.values()) {
      if (plugin.id === id) {
        plugin.enabled = enabled;
        return { success: true, plugin: this.serializePlugin(plugin) };
      }
    }
    return { success: false, error: 'Plugin not found' };
  }

  serializePlugin(plugin) {
    return {
      id: plugin.id,
      name: plugin.name,
      description: plugin.description,
      version: plugin.version,
      author: plugin.author,
      ports: plugin.ports,
      protocols: plugin.protocols,
      enabled: plugin.enabled
    };
  }
}

function parseHttp(payload) {
  try {
    const str = payload.toString('utf8', 0, Math.min(payload.length, 4096));
    const lines = str.split('\r\n');
    if (lines.length === 0) return null;

    const firstLine = lines[0];
    const isRequest = /^(GET|POST|PUT|DELETE|HEAD|OPTIONS|PATCH|CONNECT|TRACE)\s+/.test(firstLine);
    const isResponse = /^HTTP\/\d\.\d\s+\d+/.test(firstLine);

    if (!isRequest && !isResponse) return null;

    const headers = {};
    let bodyStart = -1;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i] === '') {
        bodyStart = i + 1;
        break;
      }
      const colonIdx = lines[i].indexOf(':');
      if (colonIdx > -1) {
        const key = lines[i].substr(0, colonIdx).trim();
        const val = lines[i].substr(colonIdx + 1).trim();
        headers[key] = val;
      }
    }

    const result = isRequest
      ? { type: 'request', method: firstLine.split(' ')[0], uri: firstLine.split(' ')[1], version: firstLine.split(' ')[2] }
      : { type: 'response', version: firstLine.split(' ')[0], statusCode: parseInt(firstLine.split(' ')[1]), reasonPhrase: firstLine.split(' ').slice(2).join(' ') };

    return {
      ...result,
      headers,
      body: bodyStart > -1 ? lines.slice(bodyStart).join('\n') : null
    };
  } catch (e) {
    return null;
  }
}

function parseDns(payload) {
  try {
    if (payload.length < 12) return null;

    const id = payload.readUInt16BE(0);
    const flags = payload.readUInt16BE(2);
    const qr = (flags >> 15) & 0x1;
    const opcode = (flags >> 11) & 0xf;
    const aa = (flags >> 10) & 0x1;
    const tc = (flags >> 9) & 0x1;
    const rd = (flags >> 8) & 0x1;
    const ra = (flags >> 7) & 0x1;
    const rcode = flags & 0xf;

    const qdcount = payload.readUInt16BE(4);
    const ancount = payload.readUInt16BE(6);
    const nscount = payload.readUInt16BE(8);
    const arcount = payload.readUInt16BE(10);

    let offset = 12;
    const questions = [];
    for (let i = 0; i < qdcount; i++) {
      const { name, newOffset } = readDnsName(payload, offset);
      offset = newOffset;
      const qtype = payload.readUInt16BE(offset);
      const qclass = payload.readUInt16BE(offset + 2);
      offset += 4;
      questions.push({ name, qtype, qclass });
    }

    return {
      id,
      type: qr === 0 ? 'query' : 'response',
      opcode,
      flags: { qr, aa, tc, rd, ra, rcode },
      questions,
      counts: { qdcount, ancount, nscount, arcount }
    };
  } catch (e) {
    return null;
  }
}

function readDnsName(buf, offset) {
  const labels = [];
  let jumped = false;
  let originalOffset = offset;
  let maxJumps = 10;

  while (offset < buf.length && maxJumps-- > 0) {
    const len = buf[offset];
    if (len === 0) {
      offset++;
      break;
    }
    if ((len & 0xc0) === 0xc0) {
      if (!jumped) originalOffset = offset + 2;
      offset = ((len & 0x3f) << 8) | buf[offset + 1];
      jumped = true;
    } else {
      offset++;
      labels.push(buf.toString('ascii', offset, offset + len));
      offset += len;
    }
  }

  return { name: labels.join('.'), newOffset: jumped ? originalOffset : offset };
}

const globalPluginManager = new PluginManager();

module.exports = {
  PluginManager,
  globalPluginManager,
  parseHttp,
  parseDns
};
