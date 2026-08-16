# JURIA — image de l'API (Node.js)
# Pour le MVP, l'image sert l'API. Le front Angular sera ajouté ensuite,
# soit servi en statique par cette image, soit hébergé séparément.
FROM node:20-slim

WORKDIR /app

# Dépendances (couche mise en cache tant que package.json ne change pas)
COPY backend/package*.json ./backend/
RUN cd backend && npm install --omit=dev

# Code applicatif
COPY backend ./backend

WORKDIR /app/backend
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "server.js"]
