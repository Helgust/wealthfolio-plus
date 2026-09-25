# Второй экземпляр Wealthfolio на VPS: форк + Planificador ES

Дата: 2026-09-26. Как запустить сборку форка с аддоном рядом с уже работающим официальным
Wealthfolio на том же VPS, от того же пользователя Linux, на отдельном поддомене. Основной экземпляр
при этом не меняется.

Проверено локально (Windows, 25.09.2026): веб-сборка фронтенда форка, сервер, установка ZIP аддона
через веб-API, страница Planificador ES с net worth из API форка. **Сборка Docker-образа на VPS ещё
не проверялась.**

Условные обозначения: `example.com` — ваш домен, `money-dev.example.com` — поддомен для форка,
`<основной>` — имя контейнера нынешнего Wealthfolio.

## Что получится

Экземпляры разделены всем, кроме пользователя Linux:

| | Основной | Форк |
|---|---|---|
| Образ | `wealthfolio/wealthfolio` | `wealthfolio-plus`, собран из форка |
| Контейнер | `<основной>` | `wealthfolio-dev` |
| Том с данными | свой | `wealthfolio-dev_data` |
| Порт на VPS | свой | `127.0.0.1:8089` |
| Адрес | `example.com` или ваш поддомен | `money-dev.example.com` |

**Никогда не подключайте форк к тому же тому или файлу базы, что и основной.** Два сервера на одной
SQLite одновременно пересчитывают котировки и снимки портфеля и портят данные друг другу. Форк
работает с копией.

## 0. Осмотреться на VPS

```bash
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}'   # имя <основной> и его образ
docker compose version                                          # нужен Compose v2
free -h && df -h /                                              # память и место
sudo ss -ltnp | grep -E ':(80|443|8089) '                       # кто держит 80/443, свободен ли 8089
```

Если Docker нет (`docker: command not found`), поставить его и дать своему пользователю права на
Docker — тогда форк запускается от этого же пользователя без `sudo`:

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER      # затем выйти из SSH и зайти снова
```

Что выяснить:

- **Версия основного** — Settings → About. Форк построен на v3.8.0. Если основной новее, копия его
  базы в форке не откроется: сначала нужно влить в форк тег этой версии.
- **Где работает прокси** с HTTPS (nginx, Caddy, Traefik): прямо на VPS или в контейнере. От этого
  зависит шаг 6.
- **Память.** Сборке образа нужно около 4 ГБ. Если меньше — добавьте swap:
  ```bash
  sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile
  sudo mkswap /swapfile && sudo swapon /swapfile
  ```

## 1. Подготовка на ПК

1. Отправить ветку `plus` на GitHub: `git push`. VPS собирает то, что лежит на GitHub.
2. Собрать ZIP аддона (не при запущенном `pnpm dev:server` — оба пишут в `dist`):
   ```powershell
   cd plus/addon; pnpm build; cd ../..
   python plus/scripts/package-addon.py
   ```
   Скрипт печатает путь к `plus/addon/dist/planificador-es-<версия>.zip`. Штатный `pnpm bundle` на
   Windows не работает: ему нужны `zip` и `find`.

## 2. Образ форка

```bash
git clone -b plus https://github.com/Helgust/wealthfolio-plus.git ~/wealthfolio-plus
cd ~/wealthfolio-plus
git log -1 --oneline               # тот же коммит, что последний на ПК: иначе не было push
docker build -t wealthfolio-plus:latest .
docker tag wealthfolio-plus:latest wealthfolio-plus:$(git rev-parse --short HEAD)
```

Сборка идёт 20–40 минут и нагружает процессор, но основной экземпляр не трогает. Тег с номером
коммита нужен для отката после обновлений.

## 3. Папка экземпляра

Настройки лежат отдельно от клона, чтобы `git pull` их не касался.

```bash
mkdir -p ~/wealthfolio-dev && cd ~/wealthfolio-dev
openssl rand -base64 32                                            # → WF_SECRET_KEY
sudo apt install -y argon2
printf 'ваш-пароль' | argon2 "$(openssl rand -base64 12)" -id -e   # → WF_AUTH_PASSWORD_HASH
```

Пароль можно взять тот же, что у основного, но `WF_SECRET_KEY` — новый: им подписываются сессии
и шифруются секреты этого экземпляра.

`~/wealthfolio-dev/.env` (права `chmod 600 .env`; хеш — в одинарных кавычках, иначе Compose съест
знаки `$`):

```
WF_SECRET_KEY=<ключ>
WF_AUTH_PASSWORD_HASH='$argon2id$v=19$...'
WF_CORS_ALLOW_ORIGINS=https://money-dev.example.com
```

`~/wealthfolio-dev/compose.yml` — по образцу `compose.yml` из репозитория:

```yaml
name: wealthfolio-dev

services:
  wealthfolio:
    image: wealthfolio-plus:latest
    container_name: wealthfolio-dev
    restart: unless-stopped
    ports:
      - "127.0.0.1:8089:8088"
    volumes:
      - data:/data
    environment:
      WF_LISTEN_ADDR: "0.0.0.0:8088"
      WF_DB_PATH: "/data/wealthfolio.db"
      WF_SECRET_KEY: "${WF_SECRET_KEY:?Set WF_SECRET_KEY}"
      WF_AUTH_PASSWORD_HASH: "${WF_AUTH_PASSWORD_HASH:?Set WF_AUTH_PASSWORD_HASH}"
      WF_CORS_ALLOW_ORIGINS: "${WF_CORS_ALLOW_ORIGINS:?Set WF_CORS_ALLOW_ORIGINS}"
    healthcheck:
      test: ["CMD", "wget", "--quiet", "--tries=1", "--spider", "http://127.0.0.1:8088/api/v1/healthz"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 15s
    security_opt:
      - no-new-privileges:true
    read_only: true
    tmpfs:
      - /tmp:size=64M

volumes:
  data:
```

Порт открыт только для самого VPS (`127.0.0.1`), наружу его выпускает прокси.

## 4. Копия данных основного (по желанию)

Без копии форк стартует с пустой базой и онбордингом — тогда пропустите этот шаг.

1. В основном экземпляре: Settings → Backup & Export → Backup Database. Файл появится в его папке
   данных, в `/data/backups`.
2. На VPS:
   ```bash
   cd ~/wealthfolio-dev
   docker exec <основной> ls /data/backups
   docker cp <основной>:/data/backups/<файл> ./seed.db
   docker compose create        # создаёт контейнер и том, не запуская сервер
   docker run --rm -v wealthfolio-dev_data:/data -v "$PWD/seed.db":/seed.db:ro alpine sh -c \
     'cp /seed.db /data/wealthfolio.db && rm -f /data/wealthfolio.db-wal /data/wealthfolio.db-shm && chown -R 1000:1000 /data'
   rm seed.db
   ```
   Сервер работает от пользователя 1000, поэтому весь том отдаётся ему. Старые файлы `-wal` и `-shm`
   удаляются, иначе SQLite применит их к новой базе.

Если основной запущен не через официальный `compose.yml`, его папка данных может быть другой —
посмотрите `docker inspect <основной> --format '{{json .Mounts}}'`. Если основной вообще не в Docker
(сервис systemd из готового архива `wealthfolio-server`), его папка данных — каталог из `WF_DB_PATH`
в его `.env` (`systemctl cat <сервис>` покажет, где этот файл); бэкап берётся из подпапки `backups`
обычным `cp` (или `sudo cp`) вместо `docker cp`.

## 5. Запуск

```bash
cd ~/wealthfolio-dev
docker compose up -d
docker compose ps                                  # статус healthy
curl -s http://127.0.0.1:8089/api/v1/healthz       # ok
docker compose logs --tail 50                      # при ошибках
```

## 6. Поддомен и прокси

DNS: запись A `money-dev` → IP вашего VPS.

Проще всего скопировать блок сайта основного экземпляра и поменять в нём имя и адрес. Если же
писать с нуля, то три требования Wealthfolio к прокси:

- заголовок `X-Forwarded-Proto: https` — без него cookie сессии не получит флаг `Secure`;
- без буферизации ответа — фронтенд держит долгое соединение с событиями (SSE);
- `WF_CORS_ALLOW_ORIGINS` в `.env` — ровно этот адрес с `https://`.

**Домен за Cloudflare.** Запись `money-dev` заводится в DNS Cloudflare с включённым проксированием
(оранжевое облако), как у основного сайта. Бесплатный сертификат Cloudflare покрывает поддомены
первого уровня (`money-dev.example.com`), но не второго (`money.dev.example.com`); certbot не нужен.
Дальше смотрите режим SSL/TLS зоны:

- **Full (strict)** или **Full** — на VPS стоит сертификат для связи Cloudflare → VPS (обычно Origin
  Certificate на `*.example.com`). В блоке nginx ниже вместо `listen 80` поставьте `listen 443 ssl`
  и те же `ssl_certificate` / `ssl_certificate_key`, что у основного сайта;
- **Flexible** — Cloudflare ходит на VPS по HTTP, блок `listen 80` подходит как есть, но
  `X-Forwarded-Proto` нужно брать у Cloudflare: `proxy_set_header X-Forwarded-Proto
  $http_x_forwarded_proto;`. Иначе прокси передаст `http`, и cookie останется без `Secure`.

Cloudflare обрывает соединения, в которых больше 100 секунд тишины; Wealthfolio шлёт keep-alive
в поток событий каждые 15 секунд, так что его это не задевает.

**Caddy на VPS** (заголовки и SSE он обрабатывает сам, сертификат получает сам):

```
money-dev.example.com {
    reverse_proxy 127.0.0.1:8089
}
```

**nginx на VPS** (без Cloudflare сертификат затем получает `sudo certbot --nginx -d
money-dev.example.com`):

```nginx
server {
    listen 80;
    server_name money-dev.example.com;

    location / {
        proxy_pass http://127.0.0.1:8089;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_buffering off;
        proxy_read_timeout 1h;
    }
}
```

**Прокси в контейнере** (Caddy, Traefik, Nginx Proxy Manager в Docker): `127.0.0.1` внутри его
контейнера — это он сам, до порта 8089 на VPS он так не достучится. Подключите форк к сети прокси
(`docker network ls`) и направьте прокси на `wealthfolio-dev:8088`. В `compose.yml`:

```yaml
services:
  wealthfolio:
    # ...всё как в шаге 3, только вместо ports:
    networks: [proxy]

networks:
  proxy:
    external: true
    name: <сеть прокси>
```

## 7. Первый вход и аддон

1. Открыть `https://money-dev.example.com`, ввести пароль. С пустой базой — пройти онбординг,
   валюта EUR.
2. Settings → Add-ons → **Install from File** → ZIP с ПК → подтвердить права.
3. Проверка:
   - в боковом меню есть Planificador ES и Compare plans;
   - на странице плана у «Net worth today» подпись **from Wealthfolio**. Подпись «sum of accounts»
     означает, что API форка не отвечает — то есть запущен не тот образ;
   - Settings → About — версия 3.8.0.

## Как жить с двумя экземплярами

- Настоящие данные вносите в основной. Форк — песочница со снимком данных на момент копии.
- Обновить снимок: `docker compose stop`, затем шаг 4 с новым бэкапом, затем `docker compose up -d`.
  Планы аддона при этом заменятся теми, что лежат в копии, — то есть пропадут, если их не было в
  основном.
- Сделать бэкап форка: Settings → Backup & Export в самом форке.

## Обновление форка

```bash
cd ~/wealthfolio-plus && git pull
docker build -t wealthfolio-plus:latest .
docker tag wealthfolio-plus:latest wealthfolio-plus:$(git rev-parse --short HEAD)
cd ~/wealthfolio-dev && docker compose up -d
```

Откат: в `compose.yml` указать `image: wealthfolio-plus:<прошлый коммит>` и снова `up -d`.

Новая версия аддона — Install from File с новым ZIP поверх старого: файлы заменятся, планы останутся.
**Не удаляйте аддон (Uninstall) ради переустановки**: вместе с ним удаляется его хранилище, то есть
все планы.

## Удаление

```bash
cd ~/wealthfolio-dev && docker compose down -v    # -v удаляет и том с данными форка
```

Затем убрать сайт из прокси и запись DNS.

## Когда форк станет основным

1. Бэкап основного; скачать файл и к себе на ПК.
2. В настройках основного заменить образ на `wealthfolio-plus:latest`, том и `WF_SECRET_KEY` оставить
   прежними, затем `up -d`.
3. Установить ZIP аддона заново: аддоны лежат в папке данных экземпляра, с money-dev они не переедут.
4. Удалить `wealthfolio-dev` (раздел «Удаление»).
5. Обновления Wealthfolio с этого момента — только мержем тега в форк и пересборкой. `docker pull`
   для этого контейнера больше не делать; Watchtower и другое автообновление с него снять.

Откат на официальный образ той же версии (3.8.0) — просто смена образа: своих миграций базы в форке
нет.
