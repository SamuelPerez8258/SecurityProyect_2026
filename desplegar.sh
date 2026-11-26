#!/usr/bin/env bash
# Despliegue de PokeVault en Linux Server
# Probado para Ubuntu/Debian (apt) y CentOS Stream/Rocky/Alma (dnf)
# Uso: sudo bash desplegar.sh
# Para borrar la BD y cargarla de nuevo: sudo RESET_DB=1 bash desplegar.sh
# Para no tocar el firewall o SSH: sudo FIREWALL=0 HARDEN_SSH=0 bash desplegar.sh
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
PUERTO_BACKEND=3000

RESET_DB="${RESET_DB:-0}"
FIREWALL="${FIREWALL:-1}"
HARDEN_SSH="${HARDEN_SSH:-1}"

if [[ $EUID -ne 0 ]]; then
  echo "Corre el script con sudo"
  exit 1
fi

IP_VM="$(hostname -I | awk '{print $1}')"
echo "[*] IP de la VM: $IP_VM"

if command -v apt-get >/dev/null 2>&1; then
  DISTRO="debian"
elif command -v dnf >/dev/null 2>&1; then
  DISTRO="rhel"
else
  echo "Distro no soportada: se necesita apt-get o dnf"
  exit 1
fi
echo "[*] Familia de distro: $DISTRO"

node_ok() {
  command -v node >/dev/null 2>&1 && [[ "$(node -v | cut -d. -f1 | tr -d v)" -ge 22 ]]
}

echo "[1/9] Paquetes del sistema"
if [[ "$DISTRO" == "debian" ]]; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y git curl ca-certificates gnupg openssl nginx postgresql postgresql-contrib build-essential python3 ufw
else
  dnf install -y git curl ca-certificates openssl nginx postgresql-server postgresql-contrib policycoreutils-python-utils gcc-c++ make python3
fi

echo "[2/9] Node.js"
if ! node_ok; then
  if [[ "$DISTRO" == "debian" ]]; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y nodejs
  else
    dnf install -y nodejs npm || true
    if ! node_ok; then
      curl -fsSL https://rpm.nodesource.com/setup_22.x | bash -
      dnf install -y nodejs
    fi
  fi
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
if [[ "$DISTRO" == "rhel" ]] && [[ ! -f /var/lib/pgsql/data/PG_VERSION ]]; then
  postgresql-setup --initdb
fi
systemctl enable --now postgresql

# En CentOS/Rocky las conexiones por 127.0.0.1 vienen con "ident": se cambian a password
HBA_FILE="$(sudo -u postgres psql -tAc 'SHOW hba_file' | tr -d '[:space:]')"
if grep -Eq '^host[[:space:]].*[[:space:]](ident|peer)[[:space:]]*$' "$HBA_FILE"; then
  sed -E -i 's/^(host[[:space:]].*[[:space:]])(ident|peer)[[:space:]]*$/\1scram-sha-256/' "$HBA_FILE"
  systemctl reload postgresql
  echo "    pg_hba.conf: conexiones host con password (scram-sha-256)"
fi

# Contrasena de la BD: aleatoria la primera vez y se conserva en backend/.env
DB_PASSWORD="$(grep -s '^DB_PASSWORD=' "$APP_DIR/$BACKEND_DIR/.env" | cut -d= -f2- || true)"
if [[ ${#DB_PASSWORD} -lt 24 ]]; then
  DB_PASSWORD="$(openssl rand -hex 24)"
fi

if [[ "$RESET_DB" == "1" ]]; then
  echo "    RESET_DB=1: borrando base $DB_NAME"
  sudo -u postgres psql -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS $DB_NAME;"
  rm -f "$APP_DIR/.db_inicializada"
fi

sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$DB_USER') THEN
    CREATE ROLE $DB_USER LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '$DB_PASSWORD';
  ELSE
    ALTER ROLE $DB_USER WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '$DB_PASSWORD';
  END IF;
END
\$\$;
SQL

# El puerto real del cluster: si el 5432 ya estaba ocupado (por ejemplo por Docker)
# Ubuntu crea el cluster en 5433
PG_PORT="$(sudo -u postgres psql -tAc 'SHOW port' | tr -d '[:space:]')"
echo "    PostgreSQL escucha en el puerto $PG_PORT"

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'" | grep -q 1; then
  sudo -u postgres createdb "$DB_NAME"
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
  for archivo in schema.sql alter.sql functions.sql inserts.sql productos.sql semilla_productos.sql roles.sql usuarios_prueba.sql facturas.sql seguridad.sql vuln_idor.sql; do
    ruta_sql="$(obtener_sql "$archivo" feature/database feature/Productos)"
    if [[ -z "$ruta_sql" ]]; then
      echo "    AVISO: no se encontro $archivo en ninguna rama, se omite"
      continue
    fi
    echo "    Cargando $archivo"
    sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$DB_NAME" < "$ruta_sql"
  done
  touch "$APP_DIR/.db_inicializada"
else
  echo "    BD ya inicializada (usa RESET_DB=1 para recargarla)"
  # Migraciones que se pueden repetir: se aplican tambien sobre una BD que ya existe
  for archivo in roles.sql facturas.sql seguridad.sql; do
    ruta_sql="$(obtener_sql "$archivo" feature/database feature/Productos)"
    if [[ -n "$ruta_sql" ]]; then
      echo "    Aplicando $archivo"
      sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$DB_NAME" < "$ruta_sql"
    fi
  done
fi

sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$DB_NAME" <<SQL
-- Minimo privilegio: el usuario de la app solo lee y escribe datos.
-- No es dueno de la BD ni del esquema: no puede crear, alterar ni borrar tablas.
ALTER DATABASE $DB_NAME OWNER TO postgres;
REVOKE ALL ON DATABASE $DB_NAME FROM PUBLIC;
GRANT CONNECT ON DATABASE $DB_NAME TO $DB_USER;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM $DB_USER;
GRANT USAGE ON SCHEMA public TO $DB_USER;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM $DB_USER;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO $DB_USER;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM $DB_USER;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO $DB_USER;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO $DB_USER;
SQL

echo "[6/9] Backend (.env y dependencias)"
cd "$APP_DIR/$BACKEND_DIR"
JWT_SECRET="$(grep -s '^JWT_SECRET=' .env | cut -d= -f2- || true)"
if [[ ${#JWT_SECRET} -lt 32 ]]; then
  JWT_SECRET="$(openssl rand -hex 32)"
fi
cat > .env <<ENV
PORT=$PUERTO_BACKEND
HOST=127.0.0.1
DB_HOST=127.0.0.1
DB_PORT=$PG_PORT
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

# Carpeta de fotos que sube el backend (POST /archivos) y sirve Nginx
mkdir -p "$APP_DIR/$FRONTEND_DIR/uploads"
chown -R "$APP_USER":"$APP_USER" "$APP_DIR"
# Nginx solo necesita leer el frontend; el backend, el .env y el .git quedan cerrados
chmod 755 "$APP_DIR" "$APP_DIR/$FRONTEND_DIR" "$APP_DIR/$FRONTEND_DIR/uploads"
chmod 750 "$APP_DIR/$BACKEND_DIR"
if [[ -d "$APP_DIR/.git" ]]; then chmod 750 "$APP_DIR/.git"; fi
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
# Aislamiento: si alguien lograra ejecutar codigo en el backend, no puede
# escalar privilegios ni escribir fuera de la carpeta de fotos
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable pokevault
systemctl restart pokevault

echo "[9/9] Nginx (frontend estatico + proxy al backend)"
if [[ "$DISTRO" == "debian" ]]; then
  NGINX_CONF="/etc/nginx/sites-available/pokevault"
else
  NGINX_CONF="/etc/nginx/conf.d/pokevault.conf"
  # El server por defecto de nginx.conf no debe competir con el nuestro
  sed -i 's/ default_server;/;/' /etc/nginx/nginx.conf
fi
# Escuchar en IPv6 solo si el sistema lo tiene (si no, nginx no arranca)
LISTEN_V6=""
if [[ -f /proc/net/if_inet6 ]]; then
  LISTEN_V6="listen [::]:80 default_server;"
fi

# Cabeceras de seguridad comunes (se incluyen en cada bloque que agrega cabeceras)
cat > /etc/nginx/pokevault-headers.conf <<'HEADERS'
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header Referrer-Policy "same-origin" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=()" always;
add_header Cross-Origin-Opener-Policy "same-origin" always;
HEADERS

cat > /etc/nginx/pokevault-proxy.conf <<PROXY
proxy_pass http://127.0.0.1:$PUERTO_BACKEND;
proxy_http_version 1.1;
proxy_set_header Host \$host;
proxy_set_header X-Real-IP \$remote_addr;
# Se reemplaza (no se agrega) para que nadie falsifique su IP
proxy_set_header X-Forwarded-For \$remote_addr;
proxy_set_header X-Forwarded-Proto \$scheme;
proxy_hide_header X-Powered-By;
proxy_hide_header X-Content-Type-Options;
PROXY

cat > "$NGINX_CONF" <<NGINX
# Limites de peticiones por IP (login, registro y subidas; resto de la API)
limit_req_zone \$binary_remote_addr zone=pv_auth:10m rate=10r/m;
limit_req_zone \$binary_remote_addr zone=pv_api:10m rate=20r/s;
limit_req_status 429;

server {
    listen 80 default_server;
    $LISTEN_V6
    server_name _;

    server_tokens off;
    autoindex off;
    root $APP_DIR/$FRONTEND_DIR;
    index index.html;
    client_max_body_size 8m;
    client_body_timeout 15s;
    client_header_timeout 15s;
    keepalive_timeout 15s;
    send_timeout 15s;

    include /etc/nginx/pokevault-headers.conf;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https://images.pokemontcg.io; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'" always;

    if (\$request_method !~ ^(GET|HEAD|POST|PUT|DELETE)\$) {
        return 405;
    }

    # Fotos subidas: solo imagenes con nombre generado por el backend
    location ~ "^/uploads/[a-f0-9]{24}\.(png|jpg|webp|avif|svg)\$" {
        # VULN SERVIDOR (Content-Type mal configurado / sin nosniff):
        # al declarar un add_header propio aqui (el de cache), nginx deja de
        # heredar las cabeceras de seguridad del server (nosniff, CSP, etc.).
        # El contenido subido por usuarios termina servido sin nosniff y sin CSP,
        # y un .svg con <script> se ejecuta como documento en el navegador.
        # Lo correcto seria incluir pokevault-headers.conf y la CSP con sandbox.
        add_header Cache-Control "public, max-age=300";
        types {
            image/png png;
            image/jpeg jpg;
            image/webp webp;
            image/avif avif;
            image/svg+xml svg;
        }
        default_type application/octet-stream;
        try_files \$uri =404;
    }
    location /uploads/ {
        return 404;
    }

    # Archivos ocultos y de desarrollo que no deben verse desde el navegador
    location ~ /\. {
        return 404;
    }
    location ^~ /src/ {
        return 404;
    }
    location ~* \.(ts|mjs|json|md|map|sh|sql|env|bak|old|orig|log|lock|ya?ml|txt|tsbuildinfo)\$ {
        return 404;
    }

    # Express no distingue mayusculas ni la barra final: el limite tambien
    # aplica a /API/LOGIN, /api/login/, /Register/, etc.
    location ~* ^/+(api/+login|register)/*\$ {
        limit_req zone=pv_auth burst=5 nodelay;
        include /etc/nginx/pokevault-proxy.conf;
    }
    location ~* ^/+archivos/*\$ {
        limit_req zone=pv_auth burst=10 nodelay;
        include /etc/nginx/pokevault-proxy.conf;
    }

    location / {
        try_files \$uri \$uri/ @backend;
    }

    location @backend {
        limit_req zone=pv_api burst=40 nodelay;
        include /etc/nginx/pokevault-proxy.conf;
    }
}
NGINX
if [[ "$DISTRO" == "debian" ]]; then
  ln -sf /etc/nginx/sites-available/pokevault /etc/nginx/sites-enabled/pokevault
  rm -f /etc/nginx/sites-enabled/default
fi

# SELinux (CentOS/Rocky): nginx necesita leer el frontend y conectarse al backend
if command -v getenforce >/dev/null 2>&1 && [[ "$(getenforce)" != "Disabled" ]]; then
  setsebool -P httpd_can_network_connect 1
  chcon -R -t httpd_sys_content_t "$APP_DIR/$FRONTEND_DIR"
  echo "    SELinux: httpd_can_network_connect=1 y contexto httpd_sys_content_t en el frontend"
fi

# Firewall: abrir el puerto 80 si hay firewalld o ufw activo
if command -v firewall-cmd >/dev/null 2>&1 && systemctl is-active --quiet firewalld; then
  firewall-cmd --permanent --add-service=http
  firewall-cmd --reload
  echo "    firewalld: http abierto"
fi
SSH_PORT="$(sshd -T 2>/dev/null | awk '/^port /{print $2; exit}' || true)"
SSH_PORT="${SSH_PORT:-22}"
if [[ "$FIREWALL" == "1" ]] && command -v ufw >/dev/null 2>&1; then
  # Solo quedan abiertos SSH (con limite de intentos) y HTTP
  ufw default deny incoming >/dev/null
  ufw default allow outgoing >/dev/null
  ufw limit "$SSH_PORT/tcp" >/dev/null
  ufw allow 80/tcp >/dev/null
  ufw --force enable >/dev/null
  echo "    ufw: activo, abiertos $SSH_PORT/tcp (limitado) y 80/tcp"
elif command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  ufw allow 80/tcp
  echo "    ufw: 80/tcp abierto"
fi

# SSH: opciones del laboratorio de hardening que no dejan fuera a nadie
if [[ "$HARDEN_SSH" == "1" ]] && command -v sshd >/dev/null 2>&1 && [[ -d /etc/ssh/sshd_config.d ]]; then
  SSH_DROPIN=/etc/ssh/sshd_config.d/10-pokevault.conf
  {
    echo "MaxAuthTries 3"
    echo "LoginGraceTime 20"
    echo "PermitEmptyPasswords no"
    echo "X11Forwarding no"
    echo "PermitTunnel no"
    echo "PermitUserEnvironment no"
    if [[ "$DISTRO" == "debian" ]]; then echo "DebianBanner no"; fi
    if [[ -n "${SUDO_USER:-}" && "${SUDO_USER:-}" != "root" ]]; then echo "PermitRootLogin no"; fi
  } > "$SSH_DROPIN"
  if sshd -t 2>/dev/null; then
    systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true
    echo "    ssh: endurecido ($SSH_DROPIN)"
  else
    rm -f "$SSH_DROPIN"
    echo "    ssh: no se aplico el endurecimiento (sshd -t fallo)"
  fi
fi

nginx -t
systemctl enable nginx
systemctl restart nginx

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
echo "Puertos escuchando:"
ss -tlnp 2>/dev/null | awk 'NR>1{print "    "$4}' | sort -u
echo "Logs del backend: sudo journalctl -u pokevault -f"
