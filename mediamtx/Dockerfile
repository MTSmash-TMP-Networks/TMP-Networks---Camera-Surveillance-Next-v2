# syntax=docker/dockerfile:1.4
# TMP hardened broker: pinned upstream go2rtc v1.9.14 + isolated Go race fixes.
# Reuse the original go2rtc runtime image to preserve ffmpeg, VA-API drivers,
# the /config volume, tini init and CMD ["go2rtc","-config",...].
FROM --platform=$BUILDPLATFORM golang:1.25-alpine AS build
ARG TARGETOS=linux
ARG TARGETARCH
RUN apk add --no-cache git ca-certificates
WORKDIR /src
# Exact upstream revision for v1.9.14; no moving tags or master builds.
RUN git init . \
 && git remote add origin https://github.com/AlexxIT/go2rtc.git \
 && git fetch --depth 1 origin refs/tags/v1.9.14 \
 && git checkout --detach FETCH_HEAD \
 && test "$(git rev-parse HEAD)" = "b5948cfb25404cc5cb37b166ecaa2dca20b11d4b"
COPY patches/go2rtc-http-streams-races.patch /tmp/races.patch
# Fail closed if upstream source changes and the patch stops applying.
RUN git apply --check /tmp/races.patch && git apply /tmp/races.patch
RUN go mod download
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go test ./internal/streams ./internal/api
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -ldflags="-s -w" -o /out/go2rtc .

# Preserve the existing encoder stack and working go2rtc.yaml unchanged.
FROM alexxit/go2rtc:1.9.14
COPY --from=build /out/go2rtc /usr/local/bin/go2rtc
LABEL org.opencontainers.image.title="TMP Hardened go2rtc Broker" \
      org.opencontainers.image.version="1.9.14-tmp-racefix1" \
      org.opencontainers.image.source="https://github.com/MTSmash-TMP-Networks/TMP-Networks---Camera-Surveillance-Next-v2" \
      org.opencontainers.image.description="go2rtc v1.9.14 + locked Stream API map access"
