# Build the self-contained static site. The scratch image is intended to be
# mounted as a read-only image volume and served by the homelab nginx image.
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_BASE_PATH=/
ENV VITE_BASE_PATH=${VITE_BASE_PATH}
RUN npm run build

FROM scratch
COPY --from=build /app/dist/ /
