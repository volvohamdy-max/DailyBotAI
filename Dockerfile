FROM node:20-bookworm-slim

# Keep the immutable application image outside /app.
# JustRunMy mounts persistent storage on /app, so using /app as the image
# WORKDIR would hide newly built code behind the existing persistent volume.
WORKDIR /opt/app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
# package.json may gain runtime data-provider dependencies before the lockfile
# is refreshed on Termux. npm install keeps deployment resilient and installs
# the exact current runtime dependency set.
RUN npm install --omit=dev && npm cache clean --force

COPY . .

# Copy the freshly built application into the persistent /app volume at startup.
# Runtime database/data files already present in /app are preserved because the
# image does not contain those ignored DB files.
CMD ["sh", "-c", "mkdir -p /app && cp -a /opt/app/. /app/ && cd /app && exec node app.js"]
