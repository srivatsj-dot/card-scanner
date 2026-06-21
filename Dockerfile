# Generic container — works on Render, Railway, Fly.io, or a GoDaddy/any VPS.
# The Express server serves the built web app from the same origin, so this is
# one self-contained service.
FROM node:20-slim

WORKDIR /app

# Client-side (Vite) vars are baked in at BUILD time, so they must be passed as
# build args: docker build --build-arg VITE_GOOGLE_CLIENT_ID=... etc.
ARG VITE_GOOGLE_CLIENT_ID=""
ARG VITE_ADSENSE_CLIENT=""
ARG VITE_ADSENSE_SLOT=""
ARG VITE_GTAG_ID=""
ARG VITE_ADS_CONVERSION=""
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID \
    VITE_ADSENSE_CLIENT=$VITE_ADSENSE_CLIENT \
    VITE_ADSENSE_SLOT=$VITE_ADSENSE_SLOT \
    VITE_GTAG_ID=$VITE_GTAG_ID \
    VITE_ADS_CONVERSION=$VITE_ADS_CONVERSION \
    NPM_CONFIG_PRODUCTION=false

COPY . .
RUN npm install && npm run build

ENV NODE_ENV=production
# Server reads PORT (defaults to 8787). Hosts that inject PORT just work.
EXPOSE 8787
CMD ["npm", "start"]
