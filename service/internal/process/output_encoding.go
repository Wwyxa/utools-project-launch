package process

import "unicode/utf8"

type processOutputDecoder struct {
	pending []byte
	legacy  bool
}

func (decoder *processOutputDecoder) decode(output []byte, final bool) string {
	decoder.pending = append(decoder.pending, output...)
	complete := completeProcessOutputPrefix(decoder.pending)
	if decoder.legacy {
		complete = completeLegacyOutputPrefix(decoder.pending)
	}
	if final {
		complete = len(decoder.pending)
	}
	decoder.legacy = decoder.legacy || !utf8.Valid(decoder.pending[:complete])
	message := string(decoder.pending[:complete])
	if decoder.legacy {
		message = decodeLegacyProcessOutput(decoder.pending[:complete])
	}
	decoder.pending = append(decoder.pending[:0], decoder.pending[complete:]...)
	return message
}

func completeProcessOutputPrefix(output []byte) int {
	for offset := 0; offset < len(output); {
		if !utf8.FullRune(output[offset:]) {
			return offset
		}
		character, size := utf8.DecodeRune(output[offset:])
		if character == utf8.RuneError && size == 1 {
			return completeLegacyOutputPrefix(output)
		}
		offset += size
	}
	return len(output)
}
