Markdown

# Guía de Configuración y Ejecución - Prueba de Estrés k6 con Grafana

## 1. Visión General

Este proyecto utiliza k6 para ejecutar pruebas de estrés simulando el flujo de login y respuesta de encuestas de usuarios. Los resultados y métricas de rendimiento se envían a una base de datos InfluxDB y se visualizan en un dashboard de Grafana para facilitar el análisis.

Esta guía te ayudará a instalar los componentes necesarios y ejecutar las pruebas en diferentes sistemas operativos.

## 2. Prerrequisitos (Instalación de Software)

Necesitas instalar tres componentes principales: **k6**, **InfluxDB (v1.8)** y **Grafana**. Las instrucciones varían según tu sistema operativo:

---

### **A. k6 (Motor de Pruebas)**

* **Linux (Debian/Ubuntu):**
    ```bash
    sudo apt-get update
    sudo apt-get install -y apt-transport-https software-properties-common
    # Clave GPG oficial de k6/Grafana
    sudo apt-key adv --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
    echo "deb [https://dl.k6.io/deb](https://dl.k6.io/deb) stable main" | sudo tee /etc/apt/sources.list.d/k6.list
    sudo apt-get update
    sudo apt-get install k6
    ```
* **macOS:**
    ```bash
    brew install k6
    ```
* **Windows:**
    * Descarga el instalador `.msi` desde la [página oficial de k6 Releases](https://github.com/grafana/k6/releases).
    * También puedes usar gestores de paquetes como Chocolatey (`choco install k6`) o Scoop (`scoop install k6`).
* **Verificación:** Abre una terminal y ejecuta `k6 version`. Debería mostrar la versión instalada.

---

### **B. InfluxDB (Base de Datos de Métricas - ¡Versión 1.8!)**

**IMPORTANTE:** Se recomienda **InfluxDB v1.8.x** por compatibilidad directa con la salida de k6. Las versiones 2.x requieren configuraciones diferentes.

* **Linux (Debian/Ubuntu):** Sigue los pasos de la [documentación oficial de InfluxData para instalar v1.8](https://docs.influxdata.com/influxdb/v1.8/introduction/install/) (implica añadir su repositorio `apt` y luego `sudo apt-get install influxdb=1.8.10-1` o la versión 1.8.x más reciente disponible).
* **macOS:**
    ```bash
    brew install influxdb@1
    ```
    *(Esto instala la última versión de la rama 1.x)*
* **Windows:**
    * InfluxDB 1.8 no tiene un instalador oficial simple para Windows nativo.
    * **Recomendación:** Instala InfluxDB v1.8 **dentro de WSL** siguiendo los pasos de Debian/Ubuntu.
* **Verificación:** Si usas `systemd` o `brew services`, verifica el estado. Si lo inicias manualmente, ejecuta `influxd version`.

---

### **C. Grafana (Visualización)**

* **Linux (Debian/Ubuntu):** Sigue los pasos de la [documentación oficial de Grafana para instalación con APT](https://grafana.com/docs/grafana/latest/setup-grafana/installation/debian/) (implica añadir su repositorio `apt`).
* **macOS:**
    ```bash
    brew install grafana
    ```
* **Windows:**
    * Descarga el instalador `.msi` desde la [página oficial de Grafana Downloads](https://grafana.com/grafana/download).
    * **Alternativa (WSL):** Puedes instalarlo dentro de WSL siguiendo los pasos de Debian/Ubuntu.
* **Verificación:** Accede a `http://localhost:3000` en tu navegador (usuario/contraseña por defecto: `admin`/`admin`).

---

### **D. Git (Recomendado para obtener los archivos del proyecto)**

* Instala Git para clonar fácilmente el proyecto. Busca las instrucciones de instalación de Git para tu sistema operativo específico.

## 3. Archivos del Proyecto

Necesitarás los siguientes archivos, idealmente obtenidos clonando el repositorio del proyecto:

tu-proyecto/
├── testStress.js             # Script principal de k6
├── users.json                # Datos de usuario para las pruebas
├── grafana_provisioning/     # Carpeta con config. de Grafana
│   ├── dashboard-provider.yaml     # Define cómo Grafana encuentra dashboards
│   └── k6-summary-dashboard.json # Define el dashboard específico
└── README.md                 # Este archivo


## 4. Configuración Inicial (Una vez por máquina)

1.  **Obtén los Archivos del Proyecto:**
    * **Recomendado (Git):** `git clone <URL_del_repositorio>`
    * **Alternativa:** Copia manualmente la carpeta completa del proyecto.

2.  **Configura Grafana Provisioning:** (Necesitarás permisos de administrador/sudo)
    * Crea el directorio de provisioning de dashboards en el sistema si no existe:
        ```bash
        # En Linux / WSL:
        sudo mkdir -p /etc/grafana/provisioning/dashboards
        # En macOS (si instalaste con brew, la ruta puede variar, busca grafana.ini):
        # Ejemplo: sudo mkdir -p /usr/local/etc/grafana/provisioning/dashboards
        ```
    * Copia los archivos de configuración desde tu proyecto a la ruta del sistema correspondiente:
        ```bash
        # En Linux / WSL:
        sudo cp grafana_provisioning/dashboard-provider.yaml /etc/grafana/provisioning/dashboards/
        sudo cp grafana_provisioning/k6-summary-dashboard.json /etc/grafana/provisioning/dashboards/

        # En macOS (ajusta ruta si es diferente):
        # sudo cp grafana_provisioning/dashboard-provider.yaml /usr/local/etc/grafana/provisioning/dashboards/
        # sudo cp grafana_provisioning/k6-summary-dashboard.json /usr/local/etc/grafana/provisioning/dashboards/
        ```
    * Verifica/Activa la ruta de provisioning en `grafana.ini`:
        * Localiza `grafana.ini` (Linux: `/etc/grafana/grafana.ini`, macOS: `/usr/local/etc/grafana/grafana.ini` o donde lo instale brew).
        * Asegúrate de que la línea `provisioning = /ruta/a/grafana/provisioning` (ej. `/etc/grafana/provisioning`) esté descomentada (sin `;` al inicio) y apunte al directorio *principal* de provisioning.
    * Ajusta permisos si es necesario (ej. en Linux, asumiendo que Grafana corre como usuario/grupo `grafana`):
        ```bash
        sudo chown root:grafana /etc/grafana/provisioning/dashboards/*
        sudo chmod 644 /etc/grafana/provisioning/dashboards/*
        ```

3.  **Crea Base de Datos InfluxDB:**
    * Asegúrate de que InfluxDB esté corriendo (ver Paso 5.A).
    * Ejecuta desde la terminal:
        ```bash
        influx -execute 'CREATE DATABASE k6'
        ```
        *(Si `influx` no está en el PATH, ejecútalo desde su directorio de instalación).*

## 5. Ejecución de una Prueba

Necesitarás al menos dos terminales abiertas (o ejecutar procesos en segundo plano).

1.  **Terminal 1: Iniciar InfluxDB**
    * **Método Manual (Confirmado para WSL/Linux):**
        ```bash
        sudo influxd
        ```
        *(Verifica que no haya errores de permiso. Ocupa la terminal).*
    * **Alternativa macOS (Servicio Brew):** `brew services start influxdb@1`
    * **Alternativa Linux (Servicio Systemd):** `sudo systemctl start influxdb`

2.  **Terminal 2: Iniciar Grafana**
    * **Método Manual (Confirmado para WSL/Linux):**
        ```bash
        # Asegúrate que no haya otro proceso corriendo (ps aux | grep grafana, sudo kill <PID>)
        sudo nohup /usr/sbin/grafana-server --config=/etc/grafana/grafana.ini --homepath=/usr/share/grafana > /tmp/grafana.log 2>&1 &
        ```
        *(Corre en segundo plano. Revisa `/tmp/grafana.log` por errores).*
    * **Alternativa macOS (Servicio Brew):** `brew services start grafana`
    * **Alternativa Linux (Servicio Systemd):** `sudo systemctl start grafana-server`

3.  **Terminal 3 (o reutiliza una): Ejecutar k6**
    * Navega al directorio raíz de tu proyecto (donde está `testStress.js`).
    * Ejecuta la prueba:
        ```bash
        k6 run --out influxdb=http://localhost:8086/k6 testStress.js
        ```
    * Observa la salida por errores de k6 o de escritura a InfluxDB.

## 6. Visualización de Resultados

1.  Abre tu navegador web y ve a `http://localhost:3000`.
2.  Inicia sesión en Grafana (admin/admin por defecto).
3.  Navega a **Dashboards** (icono 4 cuadrados) -> **Browse**.
4.  Entra a la carpeta **`k6 Tests`**.
5.  Abre el dashboard **`k6 Summary Dashboard`**.
6.  Ajusta el **rango de tiempo** en la esquina superior derecha para que coincida con la ejecución de tu prueba (ej. "Last 5 minutes", "Last 15 minutes").

## 7. Detener Servicios (Si se iniciaron manualmente)

* **Grafana (Manual/Nohup):**
    * Busca el PID: `ps aux | grep 'grafana server'` (el proceso `/usr/share/grafana/bin/grafana server...`)
    * Detén el proceso: `sudo kill <PID>`
* **InfluxDB (Manual):**
    * Ve a la terminal donde ejecutaste `sudo influxd` y presiona `Ctrl+C`. Si corría en segundo plano, busca el PID (`ps aux | grep influxd`) y usa `sudo kill <PID>`.
