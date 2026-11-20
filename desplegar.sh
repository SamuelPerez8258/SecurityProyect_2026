#!/usr/bin/env bash
# Despliegue de PokeVault en Ubuntu Server (22.04 / 24.04)
# Uso: sudo bash desplegar.sh
# Para borrar la BD y cargarla de nuevo: sudo RESET_DB=1 bash desplegar.sh
set -euo pipefail

REPO_URL="https://github.com/SamuelPerez8258/SecurityProyect_2026.git"
RAMA="develop"
APP_DIR="/opt/pokevault"
BACKEND_DIR="backend"
FRONTEND_DIR="Frontend"
ENTRY="index.js"
APP_USER="pokevault"

DB_NAME="pokevault"
DB_USER="pokevault"
DB_PASSWORD="PokeVault2026"
PUERTO_BACKEND=3000

RESET_DB="${RESET_DB:-0}"

if [[ $EUID -ne 0 ]]; then
  echo "Corre el script con sudo"
  exit 1
fi

IP_VM="$(hostname -I | awk '{print $1}')"
echo "[*] IP de la VM: $IP_VM"

echo "[1/9] Paquetes del sistema"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y git curl ca-certificates gnupg openssl nginx postgresql postgresql-contrib

echo "[2/9] Node.js 20"
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | cut -d. -f1 | tr -d v)" -lt 18 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
NODE_BIN="$(command -v node)"
echo "    node $(node -v) / npm $(npm -v)"

echo "[3/9] Codigo del repo (rama $RAMA)"
git config --global --add safe.directory "$APP_DIR"
if [[ -d "$APP_DIR/.git" ]]; then
  git -C "$APP_DIR" fetch --all --prune
  git -C "$APP_DIR" checkout "$RAMA"
  git -C "$APP_DIR" reset --hard "origin/$RAMA"
else
  echo "    Si el repo es privado: usuario de GitHub y como password un token (PAT)"
  git clone --branch "$RAMA" "$REPO_URL" "$APP_DIR"
  git -C "$APP_DIR" fetch --all --prune
fi

echo "[4/9] Usuario del sistema"
id "$APP_USER" >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin "$APP_USER"

echo "[5/9] PostgreSQL"
systemctl enable --now postgresql

if [[ "$RESET_DB" == "1" ]]; then
  echo "    RESET_DB=1: borrando base $DB_NAME"
  sudo -u postgres psql -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS $DB_NAME;"
  rm -f "$APP_DIR/.db_inicializada"
fi

sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$DB_USER') THEN
    CREATE ROLE $DB_USER LOGIN PASSWORD '$DB_PASSWORD';
  ELSE
    ALTER ROLE $DB_USER WITH LOGIN PASSWORD '$DB_PASSWORD';
  END IF;
END
\$\$;
SQL

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'" | grep -q 1; then
  sudo -u postgres createdb -O "$DB_USER" "$DB_NAME"
fi

# Busca un .sql en la rama actual; si no esta, lo saca de otras ramas del remoto
obtener_sql() {
  local nombre="$1"
  shift
  local encontrado
  encontrado="$(find "$APP_DIR" -name node_modules -prune -o -type f -name "$nombre" -print 2>/dev/null | head -n1 || true)"
  if [[ -n "$encontrado" ]]; then
    echo "$encontrado"
    return 0
  fi
  local rama ruta
  for rama in "$@"; do
    ruta="$(git -C "$APP_DIR" ls-tree -r --name-only "origin/$rama" 2>/dev/null | grep -E "(^|/)$nombre\$" | head -n1 || true)"
    if [[ -n "$ruta" ]]; then
      git -C "$APP_DIR" show "origin/$rama:$ruta" > "/tmp/$nombre"
      echo "    $nombre tomado de origin/$rama:$ruta" >&2
      echo "/tmp/$nombre"
      return 0
    fi
  done
  return 0
}

if [[ ! -f "$APP_DIR/.db_inicializada" ]]; then
  for archivo in schema.sql alter.sql functions.sql inserts.sql productos.sql semilla_productos.sql roles.sql usuarios_prueba.sql; do
    ruta_sql="$(obtener_sql "$archivo" feature/database feature/Productos)"
    if [[ -z "$ruta_sql" ]]; then
      echo "    AVISO: no se encontro $archivo en ninguna rama, se omite"
      continue
    fi
    echo "    Cargando $archivo"
    sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$DB_NAME" < "$ruta_sql"
  done
  sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$DB_NAME" <<SQL
GRANT ALL ON SCHEMA public TO $DB_USER;
GRANT ALL ON ALL TABLES IN SCHEMA public TO $DB_USER;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO $DB_USER;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO $DB_USER;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO $DB_USER;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO $DB_USER;
SQL
  touch "$APP_DIR/.db_inicializada"
else
  echo "    BD ya inicializada (usa RESET_DB=1 para recargarla)"
fi

echo "[6/9] Backend (.env y dependencias)"
cd "$APP_DIR/$BACKEND_DIR"
JWT_SECRET="$(grep -s '^JWT_SECRET=' .env | cut -d= -f2- || true)"
if [[ ${#JWT_SECRET} -lt 32 ]]; then
  JWT_SECRET="$(openssl rand -hex 32)"
fi
cat > .env <<ENV
PORT=$PUERTO_BACKEND
DB_HOST=127.0.0.1
DB_PORT=5432
DB_USER=$DB_USER
DB_PASSWORD=$DB_PASSWORD
DB_NAME=$DB_NAME
JWT_SECRET=$JWT_SECRET
FRONTEND_ORIGIN=http://$IP_VM
NODE_ENV=development
ENV
chmod 600 .env
if [[ -f package-lock.json ]]; then
  npm ci --omit=dev
else
  npm install --omit=dev
fi

echo "[7/9] Frontend"
# No se corre npm run compilar: los .js del repo tienen cambios que no estan en src/lib/*.ts
CONFIG_JS="$APP_DIR/$FRONTEND_DIR/js/config.js"
if [[ -f "$CONFIG_JS" ]]; then
  sed -E -i "s#URL_BASE:[[:space:]]*[\"'][^\"']*[\"']#URL_BASE: window.location.origin#" "$CONFIG_JS"
  sed -E -i "s#modo:[[:space:]]*[\"']mock[\"']#modo: 'http'#" "$CONFIG_JS"
  echo "    config.js:"
  grep -nE "URL_BASE|modo" "$CONFIG_JS" | sed 's/^/      /'
else
  echo "    AVISO: no existe $CONFIG_JS"
fi

chown -R "$APP_USER":"$APP_USER" "$APP_DIR"
chmod 600 "$APP_DIR/$BACKEND_DIR/.env"

echo "[8/9] Servicio systemd del backend"
cat > /etc/systemd/system/pokevault.service <<UNIT
[Unit]
Description=PokeVault backend (Express)
After=network.target postgresql.service
Requires=postgresql.service

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR/$BACKEND_DIR
EnvironmentFile=$APP_DIR/$BACKEND_DIR/.env
ExecStart=$NODE_BIN $ENTRY
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable pokevault
systemctl restart pokevault

echo "[9/9] Nginx (frontend estatico + proxy al backend)"
cat > /etc/nginx/sites-available/pokevault <<NGINX
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    root $APP_DIR/$FRONTEND_DIR;
    index index.html;
    client_max_body_size 10m;

    location / {
        try_files \$uri \$uri/ @backend;
    }

    location @backend {
        proxy_pass http://127.0.0.1:$PUERTO_BACKEND;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
NGINX
ln -sf /etc/nginx/sites-available/pokevault /etc/nginx/sites-enabled/pokevault
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable nginx
systemctl reload nginx || systemctl restart nginx

echo
echo "[*] Verificacion"
sleep 3
echo "    backend: $(systemctl is-active pokevault)"
echo "    nginx:   $(systemctl is-active nginx)"
echo "    GET /           -> $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1/)"
echo "    GET /productos  -> $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1/productos)"
echo "    GET /api/me     -> $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1/api/me) (401 es normal sin login)"
echo
echo "Listo: abre http://$IP_VM desde el navegador del host"
echo "Usuarios de prueba:"
echo "    admin@pokevault.local     / Admin12345    (administrador)"
echo "    vendedor@pokevault.local  / Vendedor123   (vendedor)"
echo "    comprador@pokevault.local / Comprador123  (comprador)"
echo "Logs del backend: sudo journalctl -u pokevault -f"
