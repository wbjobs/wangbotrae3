use anyhow::{Context, Result};
use boa_engine::{Context as JsContext, Source, Value};
use serde_json::Value as JsonValue;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use crate::models::*;

const DEFAULT_PARSE_TIMEOUT_MS: u64 = 100;

pub struct ProtocolEngine {
    parsers: Arc<Mutex<HashMap<String, ProtocolParser>>>,
    js_context: Arc<Mutex<JsContext>>,
}

impl ProtocolEngine {
    pub fn new() -> Result<Self> {
        let mut js_context = JsContext::default();
        setup_js_environment(&mut js_context)?;

        let mut engine = Self {
            parsers: Arc::new(Mutex::new(HashMap::new())),
            js_context: Arc::new(Mutex::new(js_context)),
        };

        engine.register_builtin_parsers()?;
        Ok(engine)
    }

    fn register_builtin_parsers(&mut self) -> Result<()> {
        let dbus_parser = create_dbus_parser();
        let grpc_parser = create_grpc_parser();
        let tlv_parser = create_tlv_parser();
        let json_parser = create_json_parser();

        self.register_parser(dbus_parser)?;
        self.register_parser(grpc_parser)?;
        self.register_parser(tlv_parser)?;
        self.register_parser(json_parser)?;

        Ok(())
    }

    pub fn register_parser(&self, parser: ProtocolParser) -> Result<()> {
        let mut parsers = self.parsers.lock().unwrap();
        parsers.insert(parser.id.clone(), parser);
        Ok(())
    }

    pub fn unregister_parser(&self, parser_id: &str) -> Result<()> {
        let mut parsers = self.parsers.lock().unwrap();
        parsers.remove(parser_id);
        Ok(())
    }

    pub fn list_parsers(&self) -> Vec<ProtocolParser> {
        let parsers = self.parsers.lock().unwrap();
        let mut list: Vec<ProtocolParser> = parsers.values().cloned().collect();
        list.sort_by(|a, b| {
            b.priority.cmp(&a.priority)
                .then_with(|| a.name.cmp(&b.name))
                .then_with(|| a.version.cmp(&b.version))
        });
        list
    }

    pub fn get_parser(&self, parser_id: &str) -> Option<ProtocolParser> {
        let parsers = self.parsers.lock().unwrap();
        parsers.get(parser_id).cloned()
    }

    pub fn parse_message(&self, request: &ParseRequest) -> ParseResult {
        let parsers = self.list_parsers();

        for parser in parsers {
            if !parser.ipc_types.contains(&request.ipc_type) {
                continue;
            }

            if let Some(ports) = &parser.port_filters {
                if !ports.contains(&request.fd.unwrap_or(0)) {
                    continue;
                }
            }

            if let Some(pattern) = &parser.content_pattern {
                if !content_matches_pattern(&request.content, pattern) {
                    continue;
                }
            }

            match self.execute_parser(&parser, request) {
                Ok(result) => {
                    if result.success {
                        return result;
                    }
                }
                Err(e) => {
                    tracing::warn!("Parser '{}' execution failed: {}", parser.name, e);
                }
            }
        }

        ParseResult {
            success: false,
            protocol_name: "unknown".to_string(),
            protocol_version: "0.0".to_string(),
            message_name: None,
            fields: vec![],
            raw_json: None,
            error: Some("No matching protocol parser found".to_string()),
            parse_time_ms: None,
        }
    }

    fn execute_parser(
        &self,
        parser: &ProtocolParser,
        request: &ParseRequest,
    ) -> Result<ParseResult> {
        let start = Instant::now();
        let mut js_context = self.js_context.lock().unwrap();

        let content_b64 = base64::encode(&request.content);
        let content_text = String::from_utf8_lossy(&request.content).to_string();

        let request_obj = serde_json::json!({
            "content": content_text,
            "contentBase64": content_b64,
            "contentBytes": request.content,
            "ipcType": format!("{:?}", request.ipc_type),
            "fd": request.fd,
            "sourcePid": request.source_pid,
            "targetPid": request.target_pid,
            "direction": format!("{:?}", request.direction),
        });

        let script = format!(
            r#"
            (function() {{
                const request = {};
                const result = {};
                return JSON.stringify(result || {{ success: false }});
            }})()
            "#,
            request_obj.to_string(),
            parser.script
        );

        let timeout = std::time::Duration::from_millis(DEFAULT_PARSE_TIMEOUT_MS);
        let start_time = Instant::now();

        js_context
            .eval(Source::from_bytes(script.as_bytes()))
            .context("JS script execution failed")
            .and_then(|result| {
                let result_str = result
                    .to_string(&mut js_context)
                    .context("Failed to convert JS result to string")?
                    .to_std_string()?;

                let parse_result: ParseResult = serde_json::from_str(&result_str)
                    .unwrap_or_else(|_| ParseResult {
                        success: false,
                        protocol_name: parser.name.clone(),
                        protocol_version: parser.version.clone(),
                        message_name: None,
                        fields: vec![],
                        raw_json: None,
                        error: Some(format!("Parser returned invalid JSON: {}", result_str)),
                        parse_time_ms: None,
                    });

                Ok(parse_result)
            })
            .or_else(|e| {
                Ok(ParseResult {
                    success: false,
                    protocol_name: parser.name.clone(),
                    protocol_version: parser.version.clone(),
                    message_name: None,
                    fields: vec![],
                    raw_json: None,
                    error: Some(e.to_string()),
                    parse_time_ms: None,
                })
            })
            .map(|mut result| {
                result.parse_time_ms = Some(start_time.elapsed().as_millis() as u64);
                result.protocol_name = parser.name.clone();
                result.protocol_version = parser.version.clone();
                result
            })
    }

    pub fn serialize_message(&self, request: &SerializeRequest) -> Result<Vec<u8>> {
        let parsers = self.parsers.lock().unwrap();
        let parser = parsers
            .values()
            .find(|p| p.name == request.protocol_name && p.version == request.protocol_version)
            .context("Parser not found for serialization")?;

        let mut js_context = self.js_context.lock().unwrap();

        let fields_json = serde_json::to_string(&request.fields)?;
        let raw_json_str = request
            .raw_json
            .as_ref()
            .map(|v| v.to_string())
            .unwrap_or_else(|| "null".to_string());

        let script = format!(
            r#"
            (function() {{
                const fields = {};
                const rawJson = {};
                {}
                const result = serialize(fields, rawJson);
                if (result && result.bytes) {{
                    return result.bytes;
                }}
                if (result && result.base64) {{
                    return {{ base64: result.base64 }};
                }}
                if (typeof result === 'string') {{
                    return result;
                }}
                throw new Error('serialize function must return {{ bytes: [...] }} or {{ base64: "..." }} or string');
            }})()
            "#,
            fields_json, raw_json_str, parser.script
        );

        let result = js_context
            .eval(Source::from_bytes(script.as_bytes()))
            .context("JS serialization failed")?;

        if result.is_object() {
            if let Some(bytes_val) = result.as_object().and_then(|o| o.get("bytes", &mut js_context).ok()) {
                if let Some(arr) = bytes_val.as_object() {
                    if arr.is_array() {
                        let mut bytes = Vec::new();
                        for i in 0.. {
                            match arr.get(i, &mut js_context) {
                                Ok(val) if val.is_number() => {
                                    bytes.push(val.as_number().unwrap_or_default() as u8);
                                }
                                _ => break,
                            }
                        }
                        return Ok(bytes);
                    }
                }
            }
            if let Some(base64_val) = result.as_object().and_then(|o| o.get("base64", &mut js_context).ok()) {
                let b64_str = base64_val
                    .to_string(&mut js_context)
                    .context("Failed to convert base64 to string")?
                    .to_std_string()?;
                return base64::decode(&b64_str).context("Base64 decode failed");
            }
        }

        if result.is_string() {
            let s = result
                .to_string(&mut js_context)
                .context("Failed to convert result to string")?
                .to_std_string()?;
            return Ok(s.into_bytes());
        }

        Err(anyhow::anyhow!(
            "Serializer must return {{ bytes: [...] }}, {{ base64: '...' }}, or string"
        ))
    }

    pub fn update_parser(&self, parser_id: &str, mut parser: ProtocolParser) -> Result<()> {
        let mut parsers = self.parsers.lock().unwrap();
        if !parsers.contains_key(parser_id) {
            return Err(anyhow::anyhow!("Parser not found"));
        }
        parser.id = parser_id.to_string();
        parser.updated_at = chrono::Utc::now().to_rfc3339();
        parsers.insert(parser_id.to_string(), parser);
        Ok(())
    }
}

fn setup_js_environment(js_context: &mut JsContext) -> Result<()> {
    let helper_code = r#"
        globalThis.atob = function(str) {
            var table = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
            // ... simplified implementation
            return str;
        };
        globalThis.btoa = function(str) {
            var table = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
            return str;
        };
        globalThis.TextDecoder = function(encoding) {
            return {
                decode: function(bytes) {
                    if (typeof bytes === 'string') return bytes;
                    if (Array.isArray(bytes)) {
                        return String.fromCharCode.apply(null, bytes);
                    }
                    return String(bytes);
                }
            };
        };
        globalThis.TextEncoder = function() {
            return {
                encode: function(str) {
                    var bytes = [];
                    for (var i = 0; i < str.length; i++) {
                        bytes.push(str.charCodeAt(i));
                    }
                    return bytes;
                }
            };
        };
        globalThis.console = {
            log: function() {},
            warn: function() {},
            error: function() {}
        };
    "#;

    js_context
        .eval(Source::from_bytes(helper_code.as_bytes()))
        .context("Failed to setup JS environment")?;

    Ok(())
}

fn content_matches_pattern(content: &[u8], pattern: &str) -> bool {
    if content.is_empty() {
        return false;
    }

    if let Ok(text) = String::from_utf8(content.to_vec()) {
        if text.contains(pattern) {
            return true;
        }
    }

    false
}

fn create_dbus_parser() -> ProtocolParser {
    let script = r#"
        function parse(request) {
            if (request.ipcType !== 'DBus') {
                return { success: false };
            }
            const text = request.content;
            if (!text || text.length < 4) {
                return { success: false };
            }

            const parts = text.split('\t');
            let fields = [];
            let messageName = null;

            if (parts.length >= 3) {
                messageName = parts[0];
                fields.push({
                    name: "message_type",
                    field_type: "String",
                    value: parts[0]
                });
                fields.push({
                    name: "destination",
                    field_type: "String",
                    value: parts[1]
                });
                if (parts[2]) {
                    fields.push({
                        name: "method",
                        field_type: "String",
                        value: parts[2]
                    });
                }
                if (parts[3]) {
                    fields.push({
                        name: "interface",
                        field_type: "String",
                        value: parts[3]
                    });
                }
            }

            try {
                return {
                    success: true,
                    message_name: messageName || 'DBus Message',
                    fields: fields,
                    raw_json: {
                        parts: parts,
                        raw_text: text
                    }
                };
            } catch (e) {
                return {
                    success: false,
                    error: e.message
                };
            }
        }

        function serialize(fields, rawJson) {
            if (rawJson && rawJson.parts) {
                return rawJson.parts.join('\t');
            }
            let parts = [];
            fields.forEach(f => {
                if (f.name === 'message_type') parts.push(f.value);
                else if (f.name === 'destination') parts.push(f.value);
                else if (f.name === 'method') parts.push(f.value);
                else if (f.name === 'interface') parts.push(f.value);
            });
            return parts.join('\t');
        }

        parse(request);
    "#;

    ProtocolParser {
        id: "builtin-dbus".to_string(),
        name: "DBus".to_string(),
        description: "DBus IPC protocol parser for session and system bus messages".to_string(),
        version: "1.0".to_string(),
        ipc_types: vec![IpcType::DBus, IpcType::UnixDomainSocket],
        port_filters: None,
        content_pattern: None,
        script: script.to_string(),
        is_builtin: true,
        created_at: chrono::Utc::now().to_rfc3339(),
        updated_at: chrono::Utc::now().to_rfc3339(),
        priority: 100,
    }
}

fn create_grpc_parser() -> ProtocolParser {
    let script = r#"
        function parse(request) {
            const text = request.content;
            const contentBytes = request.contentBytes;

            if (contentBytes && contentBytes.length >= 5) {
                const firstByte = contentBytes[0];
                const length = (contentBytes[1] << 24) |
                              (contentBytes[2] << 16) |
                              (contentBytes[3] << 8) |
                              (contentBytes[4]);

                if (firstByte === 0x00 || firstByte === 0x01) {
                    let fields = [
                        {
                            name: "compression_flag",
                            field_type: "Number",
                            value: firstByte,
                            description: firstByte === 0 ? 'No compression' : 'Compressed'
                        },
                        {
                            name: "message_length",
                            field_type: "Number",
                            value: length,
                            description: 'Length of the message payload'
                        }
                    ];

                    if (contentBytes.length > 5) {
                        const payload = contentBytes.slice(5, 5 + Math.min(length, contentBytes.length - 5));
                        fields.push({
                            name: "payload_bytes",
                            field_type: "Bytes",
                            value: Array.from(payload),
                            description: 'gRPC message payload (protobuf encoded)'
                        });

                        const utf8 = String.fromCharCode.apply(null, payload.filter(b => b > 0x20 && b < 0x7f));
                        if (utf8.length > 0) {
                            fields.push({
                                name: "utf8_preview",
                                field_type: "String",
                                value: utf8.substring(0, 100),
                                description: 'ASCII string preview'
                            });
                        }
                    }

                    return {
                        success: true,
                        message_name: 'gRPC Message',
                        fields: fields,
                        raw_json: {
                            compression: firstByte,
                            length: length,
                            payloadLength: Math.max(0, contentBytes.length - 5)
                        }
                    };
                }
            }

            if (text && (text.includes('grpc') || text.includes('application/grpc'))) {
                return {
                    success: true,
                    message_name: 'gRPC Metadata',
                    fields: [
                        {
                            name: "content",
                            field_type: "String",
                            value: text.substring(0, 200)
                        }
                    ],
                    raw_json: { text: text }
                };
            }

            return { success: false };
        }

        function serialize(fields, rawJson) {
            let bytes = [0, 0, 0, 0, 0];
            let payload = [];

            fields.forEach(f => {
                if (f.name === 'compression_flag' && typeof f.value === 'number') {
                    bytes[0] = f.value;
                }
                if (f.name === 'payload_bytes' && Array.isArray(f.value)) {
                    payload = f.value;
                }
            });

            const length = payload.length;
            bytes[1] = (length >> 24) & 0xff;
            bytes[2] = (length >> 16) & 0xff;
            bytes[3] = (length >> 8) & 0xff;
            bytes[4] = length & 0xff;
            bytes = bytes.concat(payload);

            return { bytes: bytes };
        }

        parse(request);
    "#;

    ProtocolParser {
        id: "builtin-grpc".to_string(),
        name: "gRPC".to_string(),
        description: "gRPC over HTTP/2 protocol parser with length-prefixed message support".to_string(),
        version: "1.0".to_string(),
        ipc_types: vec![IpcType::UnixDomainSocket],
        port_filters: None,
        content_pattern: None,
        script: script.to_string(),
        is_builtin: true,
        created_at: chrono::Utc::now().to_rfc3339(),
        updated_at: chrono::Utc::now().to_rfc3339(),
        priority: 90,
    }
}

fn create_tlv_parser() -> ProtocolParser {
    let script = r#"
        function parse(request) {
            const contentBytes = request.contentBytes;
            if (!contentBytes || contentBytes.length < 4) {
                return { success: false };
            }

            let fields = [];
            let offset = 0;
            let minTag = Infinity, maxTag = -Infinity;
            let reasonableTLV = true;

            while (offset + 4 <= contentBytes.length) {
                const tag = contentBytes[offset] | (contentBytes[offset + 1] << 8);
                const length = contentBytes[offset + 2] | (contentBytes[offset + 3] << 8);

                if (tag === 0 || length === 0 || length > 10240 || tag > 10000) {
                    reasonableTLV = false;
                    break;
                }

                if (offset + 4 + length > contentBytes.length) {
                    break;
                }

                if (tag < minTag) minTag = tag;
                if (tag > maxTag) maxTag = tag;

                const valueBytes = contentBytes.slice(offset + 4, offset + 4 + length);
                const textValue = String.fromCharCode.apply(null, valueBytes.filter(b => b > 0x20 && b < 0x7f));
                const isPrintable = textValue.length > length * 0.7;

                const field = {
                    name: "tag_" + tag,
                    field_type: isPrintable ? "String" : "Bytes",
                    value: isPrintable ? textValue : Array.from(valueBytes),
                    description: "Tag: " + tag + ", Length: " + length + " bytes",
                    children: [
                        {
                            name: "tag",
                            field_type: "Number",
                            value: tag
                        },
                        {
                            name: "length",
                            field_type: "Number",
                            value: length
                        }
                    ]
                };

                if (!isPrintable) {
                    field.children.push({
                        name: "hex_value",
                        field_type: "String",
                        value: Array.from(valueBytes).map(b => b.toString(16).padStart(2, '0')).join(' ')
                    });
                }

                fields.push(field);
                offset += 4 + length;
            }

            if (!reasonableTLV || fields.length === 0 || fields.length > 20) {
                return { success: false };
            }

            return {
                success: true,
                message_name: 'TLV Message (' + fields.length + ' fields)',
                fields: fields,
                raw_json: {
                    fieldCount: fields.length,
                    tagRange: [minTag, maxTag],
                    remainingBytes: contentBytes.length - offset
                }
            };
        }

        function serialize(fields, rawJson) {
            let bytes = [];
            fields.forEach(f => {
                let tag = parseInt(f.name.replace('tag_', '')) || 0;
                let valueBytes = [];

                if (typeof f.value === 'string') {
                    for (let i = 0; i < f.value.length; i++) {
                        valueBytes.push(f.value.charCodeAt(i));
                    }
                } else if (Array.isArray(f.value)) {
                    valueBytes = f.value.map(v => parseInt(v) || 0);
                }

                const length = valueBytes.length;
                bytes.push(tag & 0xff);
                bytes.push((tag >> 8) & 0xff);
                bytes.push(length & 0xff);
                bytes.push((length >> 8) & 0xff);
                bytes = bytes.concat(valueBytes);
            });
            return { bytes: bytes };
        }

        parse(request);
    "#;

    ProtocolParser {
        id: "builtin-tlv".to_string(),
        name: "TLV".to_string(),
        description: "Generic TLV (Type-Length-Value) protocol parser for custom binary formats".to_string(),
        version: "1.0".to_string(),
        ipc_types: vec![IpcType::UnixDomainSocket, IpcType::Pipe],
        port_filters: None,
        content_pattern: None,
        script: script.to_string(),
        is_builtin: true,
        created_at: chrono::Utc::now().to_rfc3339(),
        updated_at: chrono::Utc::now().to_rfc3339(),
        priority: 50,
    }
}

fn create_json_parser() -> ProtocolParser {
    let script = r#"
        function parse(request) {
            const text = request.content;
            if (!text) {
                return { success: false };
            }

            const trimmed = text.trim();
            if (!trimmed) {
                return { success: false };
            }

            if (trimmed[0] !== '{' && trimmed[0] !== '[') {
                return { success: false };
            }

            try {
                const parsed = JSON.parse(trimmed);
                let fields = [];

                function walk(obj, path, depth) {
                    if (depth > 8) return;

                    if (Array.isArray(obj)) {
                        obj.forEach((item, index) => {
                            const newPath = path ? path + '[' + index + ']' : '[' + index + ']';
                            const type = typeof item;

                            if (item === null) {
                                fields.push({
                                    name: newPath,
                                    field_type: 'Null',
                                    value: null
                                });
                            } else if (type === 'object') {
                                fields.push({
                                    name: newPath,
                                    field_type: Array.isArray(item) ? 'Array' : 'Object',
                                    value: Array.isArray(item) ? item.length : Object.keys(item).length + ' keys'
                                });
                                if (depth < 4) {
                                    walk(item, newPath, depth + 1);
                                }
                            } else {
                                fields.push({
                                    name: newPath,
                                    field_type: type.charAt(0).toUpperCase() + type.slice(1),
                                    value: item
                                });
                            }
                        });
                    } else if (typeof obj === 'object') {
                        Object.keys(obj).forEach(key => {
                            const item = obj[key];
                            const newPath = path ? path + '.' + key : key;
                            const type = typeof item;

                            if (item === null) {
                                fields.push({
                                    name: newPath,
                                    field_type: 'Null',
                                    value: null
                                });
                            } else if (type === 'object') {
                                fields.push({
                                    name: newPath,
                                    field_type: Array.isArray(item) ? 'Array' : 'Object',
                                    value: Array.isArray(item) ? item.length + ' items' : Object.keys(item).length + ' keys'
                                });
                                if (depth < 4) {
                                    walk(item, newPath, depth + 1);
                                }
                            } else {
                                fields.push({
                                    name: newPath,
                                    field_type: type.charAt(0).toUpperCase() + type.slice(1),
                                    value: item
                                });
                            }
                        });
                    }
                }

                walk(parsed, '', 0);

                let messageName = 'JSON Message';
                if (parsed.type) messageName = parsed.type;
                else if (parsed.event) messageName = parsed.event;
                else if (parsed.method) messageName = parsed.method;
                else if (parsed.action) messageName = parsed.action;

                return {
                    success: true,
                    message_name: messageName,
                    fields: fields,
                    raw_json: parsed
                };
            } catch (e) {
                return { success: false };
            }
        }

        function serialize(fields, rawJson) {
            if (rawJson) {
                return JSON.stringify(rawJson, null, 2);
            }
            let obj = {};
            fields.forEach(f => {
                const path = f.name;
                const parts = path.split(/[.\[\]]/).filter(p => p);
                let current = obj;
                for (let i = 0; i < parts.length - 1; i++) {
                    const part = parts[i];
                    if (!current[part]) {
                        current[part] = {};
                    }
                    current = current[part];
                }
                const last = parts[parts.length - 1];
                current[last] = f.value;
            });
            return JSON.stringify(obj, null, 2);
        }

        parse(request);
    "#;

    ProtocolParser {
        id: "builtin-json".to_string(),
        name: "JSON".to_string(),
        description: "JSON text protocol parser with automatic field extraction and tree display".to_string(),
        version: "1.0".to_string(),
        ipc_types: vec![IpcType::UnixDomainSocket, IpcType::DBus, IpcType::Pipe],
        port_filters: None,
        content_pattern: None,
        script: script.to_string(),
        is_builtin: true,
        created_at: chrono::Utc::now().to_rfc3339(),
        updated_at: chrono::Utc::now().to_rfc3339(),
        priority: 80,
    }
}

impl Default for ProtocolEngine {
    fn default() -> Self {
        Self::new().expect("Failed to create ProtocolEngine")
    }
}
