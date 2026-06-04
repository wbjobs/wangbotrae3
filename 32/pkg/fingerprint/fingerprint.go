package fingerprint

import (
	"crypto/sha256"
	"encoding/hex"
	"regexp"
	"sort"
	"strings"
)

var (
	numberRegex    = regexp.MustCompile(`\b\d+\.?\d*\b`)
	uuidRegex      = regexp.MustCompile(`[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}`)
	ipRegex        = regexp.MustCompile(`\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b`)
	quotedStrRegex = regexp.MustCompile(`"[^"]*"`)
	pathRegex      = regexp.MustCompile(`/[\w\-./]+`)
)

type LogFingerprint struct {
	Template   string
	Parameters []string
	Fingerprint string
}

func Generate(message string) LogFingerprint {
	template := message
	params := make(map[string]string)

	template = uuidRegex.ReplaceAllStringFunc(template, func(m string) string {
		key := "{UUID}"
		params[m] = key
		return key
	})

	template = ipRegex.ReplaceAllStringFunc(template, func(m string) string {
		key := "{IP}"
		params[m] = key
		return key
	})

	template = numberRegex.ReplaceAllStringFunc(template, func(m string) string {
		key := "{NUMBER}"
		params[m] = key
		return key
	})

	template = quotedStrRegex.ReplaceAllStringFunc(template, func(m string) string {
		key := "{STRING}"
		params[m] = key
		return key
	})

	template = pathRegex.ReplaceAllStringFunc(template, func(m string) string {
		key := "{PATH}"
		params[m] = key
		return key
	})

	paramList := make([]string, 0, len(params))
	for p := range params {
		paramList = append(paramList, p)
	}
	sort.Strings(paramList)

	hashInput := template + "|" + strings.Join(paramList, ",")
	hash := sha256.Sum256([]byte(hashInput))
	fingerprint := hex.EncodeToString(hash[:])[:16]

	return LogFingerprint{
		Template:   template,
		Parameters: paramList,
		Fingerprint: fingerprint,
	}
}
