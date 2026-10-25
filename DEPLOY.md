# Деплой UniNav на сервер

Приложение **UniNav** — статический SPA: после `npm run build` получается набор
файлов (`dist/`), которому не нужны Node.js, база данных или бэкенд. На сервере
достаточно любого статического веб-сервера: nginx, Apache, Caddy, S3/CDN,
GitHub Pages, Netlify, Vercel и т. п.

Все планы этажей (SVG) и графы (JSON) **встраиваются в сборку** через Vite.
Копировать папку `map/` на сервер не нужно — в `dist/` уже лежат готовые
хешированные ассеты.

---

## 1. Требования

Для сборки:

- Node.js **18+** (рекомендуется 20 LTS);
- npm 9+;
- ~200 МБ свободного места под `node_modules` и `dist`.

Для хостинга:

- любой статический веб-сервер;
- поддержка MIME-типа `image/svg+xml` (в nginx/Apache настроена по умолчанию);
- желательно HTTPS.

Переменные окружения и секреты не используются.

---

## 2. Сборка

### Вариант A. Сборка на своей машине / в CI

```bash
npm ci
npm run build
```

Проверьте результат локально:

```bash
npm run preview -- --host 0.0.0.0 --port 4173
# открыть http://<IP-машины>:4173/
```

### Вариант B. Сборка прямо на сервере

```bash
# на сервере должны быть Node.js 18+ и npm
git clone <URL-репозитория> /opt/uninav-src
cd /opt/uninav-src
npm ci
npm run build
```

После сборки в `dist/` появятся:

```
dist/
├── index.html
├── robots.txt
└── assets/
    ├── index-<hash>.js
    ├── index-<hash>.css
    ├── 1floor-<hash>.svg
    ├── 2floor-<hash>.svg
    └── 3floor-<hash>.svg
```

Каталога `data/` в сборке нет: графы встроены в JS, планы — в `assets/`.
`robots.txt` — единственный файл, который Vite копирует из `public/`.

Хеши в именах меняются при каждом изменении файла — это позволяет агрессивно
кэшировать ассеты.

---

## 3. Деплой на nginx (рекомендуемый вариант)

### 3.1. Копирование файлов

С локальной машины:

```bash
rsync -av --delete dist/ user@server:/var/www/uninav/
```

Или по SSH:

```bash
ssh user@server 'mkdir -p /var/www/uninav'
scp -r dist/* user@server:/var/www/uninav/
```

Права:

```bash
sudo chown -R www-data:www-data /var/www/uninav
sudo find /var/www/uninav -type d -exec chmod 755 {} \;
sudo find /var/www/uninav -type f -exec chmod 644 {} \;
```

### 3.2. Конфигурация nginx

`/etc/nginx/sites-available/uninav`:

```nginx
server {
    listen 80;
    server_name nav.example.ru;

    root /var/www/uninav;
    index index.html;

    # SPA: любой путь отдаёт index.html (deep links с ?from=&to= работают)
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Хешированные ассеты можно кэшировать надолго
    location /assets/ {
        try_files $uri =404;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # index.html не кэшируем, чтобы после деплоя сразу подхватилась новая версия
    location = /index.html {
        add_header Cache-Control "no-cache, no-store, must-revalidate";
    }

    # MIME-типы берутся из /etc/nginx/mime.types: image/svg+xml там уже есть.
    # Не задавайте директиву `types` внутри server: она заменит всю таблицу
    # типов, и .css/.js начнут отдаваться как application/octet-stream.

    gzip on;
    gzip_types text/plain text/css application/javascript application/json image/svg+xml;
    gzip_min_length 1024;
}
```

Включить сайт и проверить:

```bash
sudo ln -s /etc/nginx/sites-available/uninav /etc/nginx/sites-enabled/uninav
sudo nginx -t
sudo systemctl reload nginx
```

### 3.3. HTTPS

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d nav.example.ru
```

Certbot сам добавит `listen 443 ssl` и редирект с HTTP.

---

## 4. Деплой в подкаталог (например, `/uninav/`)

По умолчанию Vite использует абсолютные пути (`/assets/...`), поэтому при
размещении в подкаталоге нужно указать `base` **до сборки**.

Создайте `vite.config.ts` в корне проекта:

```ts
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/uninav/'
});
```

Пересоберите:

```bash
npm run build
```

Конфигурация nginx (файлы лежат в `/var/www/uninav/`):

```nginx
location /uninav/ {
    root /var/www;
    try_files $uri $uri/ /uninav/index.html;
}

# Опционально: /uninav -> /uninav/
location = /uninav {
    return 301 /uninav/;
}
```

Здесь используется `root`, а не `alias`: с `try_files` и `alias` nginx может
искать файлы по неверному пути. Если `base` не совпадает с реальным путём,
сайт откроется, но JS/CSS/SVG вернут 404 — это самая частая ошибка при
деплое в подкаталог.

---

## 5. Деплой через Docker (опционально)

`Dockerfile` в корне проекта:

```dockerfile
# --- build ---
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# --- runtime ---
FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

`deploy/nginx.conf`:

```nginx
server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /assets/ {
        try_files $uri =404;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    location = /index.html {
        add_header Cache-Control "no-cache";
    }

    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;
}
```

Сборка и запуск:

```bash
docker build -t uninav:latest .
docker run -d --name uninav -p 8080:80 --restart unless-stopped uninav:latest
```

---

## 6. Деплой на GitHub Pages / Netlify / Vercel

### GitHub Pages

Проект будет доступен по адресу `https://<user>.github.io/<repo>/`, поэтому
обязательно задайте `base: '/<repo>/'` в `vite.config.ts` (см. раздел 4).
Затем:

```bash
npm run build
npx gh-pages -d dist
```

Либо настройте GitHub Actions: `npm ci && npm run build`, публикация `dist/`.

### Netlify

- Build command: `npm run build`
- Publish directory: `dist`
- При необходимости добавьте `_redirects`:

```
/* /index.html 200
```

### Vercel

- Framework preset: **Vite**
- Build command: `npm run build`
- Output directory: `dist`

Для всех трёх платформ при размещении в подкаталоге не забудьте про `base`.

---

## 7. Проверка после деплоя

```bash
# главная страница
curl -I https://nav.example.ru/

# SVG-план (имя файла смотрите в dist/assets/)
curl -I https://nav.example.ru/assets/1floor-<hash>.svg

# deep link должен вернуть index.html
curl -I 'https://nav.example.ru/?from=D102&to=D302'
```

Ожидаемо:

- `/` → `200`, `Content-Type: text/html`;
- `*.svg` → `200`, `Content-Type: image/svg+xml`;
- deep link → `200`, `text/html` (за счёт `try_files`);
- в браузере открывается карта, переключаются этажи 1/2/3, строятся маршруты
  `D102 → D302`, `K101 → K201`, `Кафе → Актовый зал`.

Чек-лист в браузере:

1. План этажа виден, линия маршрута совпадает с коридорами.
2. Этажи переключаются кнопками и шагами маршрута.
3. Поиск находит `D105`, `Санузел`, `Столовая`, `Scool21`.
4. На мобильном работает pinch-to-zoom, на десктопе — колесо и кнопки.
5. В консоли нет 404 по `assets/*`.
6. Нет «метров» и «минут» — они намеренно убраны из UI.

---

## 8. Обновление версии

```bash
git pull
npm ci
npm run build
rsync -av --delete dist/ user@server:/var/www/uninav/
```

`index.html` отдаётся с `no-cache`, а имена ассетов содержат хеш, поэтому
пользователи получают новую версию без ручной очистки кэша.

### Откат

Держите предыдущую сборку:

```bash
tar -czf uninav-dist-$(date +%F-%H%M).tar.gz dist/
```

При проблеме распакуйте архив обратно в `/var/www/uninav/` и перезагрузите
nginx. Откат кода — `git checkout <предыдущий-коммит> && npm ci && npm run build`.

---

## 9. Возможные проблемы

| Симптом | Причина | Решение |
| --- | --- | --- |
| Белая страница, в консоли 404 на `/assets/*` | Неверный `base` при деплое в подкаталог | Задать `base` в `vite.config.ts` и пересобрать |
| 404 при обновлении страницы с параметрами | Нет SPA-fallback | Добавить `try_files $uri $uri/ /index.html;` |
| SVG не отображается | Неверный MIME-тип | Проверить `include mime.types;` в `http`; при необходимости добавить `image/svg+xml svg;` на уровне `http`, не переопределяя `types` в `server` |
| Старая версия после деплоя | Кэшируется `index.html` | Отдавать `index.html` с `no-cache` |
| Долго грузятся планы | Нет gzip/brotli | Включить сжатие для `image/svg+xml` |
| Нет фирменного шрифта | Нет доступа к `fonts.googleapis.com` | Разрешить домен или заменить шрифт локальным |

> Шрифт `Plus Jakarta Sans` подключается с Google Fonts. В закрытом контуре
> без интернета приложение продолжит работать на системном шрифте; если
> нужен офлайн-вид, скачайте шрифт в проект и подключите локально.

---

## 10. Что не нужно делать

- Не копируйте `map/` на сервер: SVG и JSON уже внутри `dist/assets/`.
- Не запускайте `npm run dev` в production — это dev-сервер Vite.
- Не открывайте `dist/index.html` через `file://` — модульные скрипты и
  ассеты рассчитаны на HTTP(S).
- Не удаляйте `dist/assets/` после деплоя: там лежат все планы и код.
