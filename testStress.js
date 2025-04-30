import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { SharedArray } from 'k6/data';
import { Trend, Rate, Counter } from 'k6/metrics';
import { htmlReport } from "https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js";


// Comando para ejecutar el programa: k6 run --out influxdb=http://localhost:8086/k6 testStress.js
// echo '<PEGA AQUÍ EL JSON COMPLETO>' | sudo tee /etc/grafana/provisioning/dashboards/k6-summary-dashboard.json > /dev/null **comando para editar json de dashboard**
// sudo kill <PID>
// ps aux | grep 'grafana server'
// Comando para iniciar grafana: sudo nohup /usr/sbin/grafana-server --config=/etc/grafana/grafana.ini --homepath=/usr/share/grafana > /tmp/grafana.log 2>&1 &

// --- CONFIGURACIÓN GENERAL ---
const url = ''
// TODO: Rellena las credenciales de administrador (como solicitaste, directamente en el script)
const adminEmail = ''
const adminPassword = ''

// TODO: Rellena las URLs de los endpoints
const adminLoginUrl = `${url}/api/auth/login`
const step2Url = `${url}/api/tools`;
const step3Url = `${url}/api/survey-sections`;
const step4Url = `${url}/api/questions`;
const step5Url = `${url}/api/missions`;
const userLoginUrl = `${url}/api/v1/auth/login?o=96`; // URL Login usuarios normales (de tu script original)
const userAnswerUrl = `${url}/api/v1/survey/answer`; // URL Respuesta encuesta (de tu script original)


// --- MÉTRICAS (conservadas de tu script original) ---
const loginTime = new Trend('login_time');
const surveyTime = new Trend('survey_time');
const loginSuccessRate = new Rate('login_success_rate');
const surveySuccessRate = new Rate('survey_success_rate');
const flowSuccessRate = new Rate('flow_success_rate');
const error403Counter = new Counter('error_403');
const error404Counter = new Counter('error_404');
const error422Counter = new Counter('error_422');
const error500Counter = new Counter('error_500');

// --- CARGA DE USUARIOS NORMALES (conservado de tu script original) ---
// Asegúrate que este archivo NO contenga al admin y esté en la misma carpeta que el script
const users = new SharedArray('users', function() {
  try {
    return JSON.parse(open('./users.json')).users;
  } catch (e) {
    // Si users.json no existe o es inválido, devolvemos un array vacío para evitar errores
    // y lanzamos una advertencia. La prueba se ejecutará sin usuarios dinámicos.
    console.warn("WARN: No se pudo cargar './users.json' o está vacío/inválido. " + e);
    return [];
  }
});

// --- OPCIONES de k6 (conservadas y adaptadas de tu script original) ---
export const options = {
  scenarios: {
    default: {
      executor: 'per-vu-iterations',
      vus: 100,
      iterations: 1,
      maxDuration: '120s'
    },
  },
  thresholds: {
    'login_time': ['p(95)<15000'],        // 15s de tiempo máximo de login
    'survey_time': ['p(95)<5000'],        // 5s de tiempo máximo para encuesta
    'login_success_rate': ['rate>0.80'],  // Al menos 80% de logins exitosos
    'survey_success_rate': ['rate>0.50']  // Umbral bajo para encuestas por los fallos
  },
};

// --- FUNCIÓN SETUP: Se ejecuta UNA VEZ al inicio para crear la encuesta ---
export function setup() {
  console.log(`--- Iniciando Setup: Creación de Encuesta como Admin (${adminEmail}) ---`);
  let authToken, step2DataId, surveyIdForUsers, surveySectionId, questionIdForUsers;

  group('Setup', function() {
    // === PASO 1: Login Admin ===
    console.log(`Setup: Intentando login admin en ${adminLoginUrl}`);
    const adminLoginPayload = {
      email: adminEmail,
      password: adminPassword
      // TODO: Añade otros campos si son necesarios en el form-data
    };
    const adminLoginParams = {
      headers: { 'Accept': 'application/json' }
      // TODO: Ajusta headers si son necesarios otros
    };
    console.log(`DEBUG: Enviando Payload (form-data):`, adminLoginPayload); // Mostramos el objeto

    // La llamada a http.post sigue igual, pero ahora recibe un objeto como payload
    const adminLoginRes = http.post(adminLoginUrl, adminLoginPayload, adminLoginParams);

    // ---> Logs de Depuración <---
    console.log(`DEBUG: Admin Login Status: ${adminLoginRes.status}`);
    console.log(`DEBUG: Admin Login Body: ${adminLoginRes.body}`);

    if (!check(adminLoginRes, { 'Setup - Admin Login OK': (r) => r.status === 200 })) {
         console.error(`Setup FAIL: Admin Login fallido! Status: ${adminLoginRes.status}, Body: ${adminLoginRes.body}`);
         throw new Error('Setup fallido: No se pudo autenticar el admin.');
    }
     try {
        // TODO: AJUSTA el path JSON para extraer el token correctamente de la respuesta
        authToken = adminLoginRes.json('data.auth_token');
        if (!authToken) throw new Error('Token no encontrado en la respuesta JSON.');
     } catch (e) {
        console.error(`Setup FAIL: Error extrayendo token del admin. Body: ${adminLoginRes.body}. Error: ${e}`);
        throw new Error('Setup fallido: No se pudo extraer el token del admin.');
     }
    console.log('Setup: Admin Logueado exitosamente.');
    const commonHeaders = {
      'Authorization': `Bearer ${authToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
      // TODO: Añade otros headers comunes si son necesarios para los siguientes pasos
    };


    // === PASO 2: POST para obtener IDs iniciales ===
    console.log(`Setup: Ejecutando Paso 2 en ${step2Url}`);
    // TODO: Define el body JSON PREDEFINIDO para el paso 2
    const step2Payload = JSON.stringify({
        "name": "test survey objectives",
        "description": "test",
        "type_tool": "Survey",
        "released": true,
        "languaje": "es",
        "validation": false,
        "valid_media": true,
        "publish": true,
        "objectives": [
            "ob 1", "ob 2", "ob 3"
        ]
    });
    const step2Res = http.post(step2Url, step2Payload, { headers: commonHeaders });

    if (!check(step2Res, { 'Setup - Paso 2 OK': (r) => r.status == 200 || 201 })) {
         console.error(`Setup FAIL: Paso 2 fallido! Status: ${step2Res.status}, Body: ${step2Res.body}`);
         throw new Error('Setup fallido: Paso 2 fallido.');
    }
    try {
      // TODO: AJUSTA los paths JSON para extraer los IDs correctamente
      step2DataId = step2Res.json('data.id');
      surveyIdForUsers = step2Res.json('data.tools.id'); // Este se pasará a los usuarios
      if (!step2DataId || !surveyIdForUsers) throw new Error('IDs no encontrados en la respuesta JSON del paso 2.');
    } catch (e) {
      console.error(`Setup FAIL: Error extrayendo IDs del paso 2. Body: ${step2Res.body}. Error: ${e}`);
      throw new Error('Setup fallido: No se pudieron extraer IDs del paso 2.');
    }
    console.log(`Setup: Paso 2 completado. surveyIdForUsers=${surveyIdForUsers}, step2DataId=${step2DataId}`);


    // === PASO 3: POST usando data.tools.id (surveyIdForUsers) ===
     console.log(`Setup: Ejecutando Paso 3 en ${step3Url}`);
     // TODO: Define el body JSON para el paso 3, usando surveyIdForUsers dinámicamente
    const step3Payload = JSON.stringify({
       title: "test21",
       description: "test21",
       survey_id: surveyIdForUsers, // <- ID dinámico obtenido en paso 2
       // other_static_key: "valor_estatico3"
    });
    const step3Res = http.post(step3Url, step3Payload, { headers: commonHeaders });

    if (!check(step3Res, { 'Setup - Paso 3 OK': (r) => r.status === 200 })) {
        console.error(`Setup FAIL: Paso 3 fallido! Status: ${step3Res.status}, Body: ${step3Res.body}`);
        throw new Error('Setup fallido: Paso 3 fallido.');
    }
    try {
      // TODO: AJUSTA el path JSON para extraer el ID correctamente
      surveySectionId = step3Res.json('data.id'); // Este se usará en paso 4
      if (!surveySectionId) throw new Error('ID (surveySectionId) no encontrado en la respuesta JSON del paso 3.');
    } catch (e) {
       console.error(`Setup FAIL: Error extrayendo ID del paso 3. Body: ${step3Res.body}. Error: ${e}`);
       throw new Error('Setup fallido: No se pudo extraer ID del paso 3.');
    }
    console.log(`Setup: Paso 3 completado. surveySectionId=${surveySectionId}`);


    // === PASO 4: POST con Form Data usando surveySectionId ===
    console.log(`Setup: Ejecutando Paso 4 en ${step4Url}`);
    // TODO: Define los datos para el form-data. k6 los enviará como multipart/form-data.
    const step4Data = {
      question_type:"Binary",
      title:"diga si",
      html:"<p>diga si</p>",
      required:true,
      survey_section_id: surveySectionId,
      order:0,
      is_incorrect:0,
      file_width:0,
      file_height:0,
      locked_ratio:0,
    };
    // Nota: No establezcas 'Content-Type' aquí, k6 lo hará automáticamente para form-data
    const step4Headers = { 'Authorization': `Bearer ${authToken}`, 'Accept': 'application/json' };
    const step4Res = http.post(step4Url, step4Data, { headers: step4Headers });

    if (!check(step4Res, { 'Setup - Paso 4 OK': (r) => r.status === 200 })) {
        console.error(`Setup FAIL: Paso 4 fallido! Status: ${step4Res.status}, Body: ${step4Res.body}`);
        throw new Error('Setup fallido: Paso 4 fallido.');
    }
     try {
        // TODO: AJUSTA el path JSON para extraer el ID correctamente
        questionIdForUsers = step4Res.json('data.id'); // Este se pasará a los usuarios
        if (!questionIdForUsers) throw new Error('ID (questionIdForUsers) no encontrado en la respuesta JSON del paso 4.');
     } catch (e) {
        console.error(`Setup FAIL: Error extrayendo ID del paso 4. Body: ${step4Res.body}. Error: ${e}`);
        throw new Error('Setup fallido: No se pudo extraer ID del paso 4.');
     }
    console.log(`Setup: Paso 4 completado. questionIdForUsers=${questionIdForUsers}`);


    // === PASO 5: POST final usando data.id del paso 2 (step2DataId) ===
     console.log(`Setup: Ejecutando Paso 5 en ${step5Url}`);
     // TODO: Define el body JSON para el paso 5, usando step2DataId dinámicamente
    const step5Payload = JSON.stringify({

        sample_size: [
            {
                "autoclose_cap": "0",
                "sample_proportion": false,
                "checkCloseNumberUser": false,
                "country_id": 48
            },
            {
                "autoclose_cap": "0",
                "sample_proportion": false,
                "checkCloseNumberUser": false,
                "country_id": 62
            },
            {
                "autoclose_cap": "0",
                "sample_proportion": false,
                "checkCloseNumberUser": false,
                "country_id": 64
            },
            {
                "autoclose_cap": "0",
                "sample_proportion": false,
                "checkCloseNumberUser": false,
                "country_id": 66
            },
            {
                "autoclose_cap": "0",
                "sample_proportion": false,
                "checkCloseNumberUser": false,
                "country_id": 90
            },
            {
                "autoclose_cap": "0",
                "sample_proportion": false,
                "checkCloseNumberUser": false,
                "country_id": 97
            },
            {
                "autoclose_cap": "0",
                "sample_proportion": false,
                "checkCloseNumberUser": false,
                "country_id": 142
            },
            {
                "autoclose_cap": "0",
                "sample_proportion": false,
                "checkCloseNumberUser": false,
                "country_id": 170
            },
            {
                "autoclose_cap": "0",
                "sample_proportion": false,
                "checkCloseNumberUser": false,
                "country_id": 173
            }
        ],
        reminders: [
            {
                "message": "Hola Membeer ! recuerda que la mision [!NOMBRE-MISION!] está activa hasta [!FECHA-INICIAL-MISION!] y se te pagará [!VALOR-DE-PUNTOS-EN-DINERO!] por participar.",
                "date": "2025-04-15 00:00:00"
            }
        ],
        points: [
            {
                "country_name": "Colombia",
                "country_id": 48,
                "app_points": 0,
                "currency": "COP",
                "points_conversion": 0
            },
            {
                "country_name": "República Dominicana",
                "country_id": 62,
                "app_points": 0,
                "currency": "DOP",
                "points_conversion": 0
            },
            {
                "country_name": "Ecuador",
                "country_id": 64,
                "app_points": 0,
                "currency": "USD",
                "points_conversion": 0
            },
            {
                "country_name": "El Salvador",
                "country_id": 66,
                "app_points": 0,
                "currency": "USD",
                "points_conversion": 0
            },
            {
                "country_name": "Guatemala",
                "country_id": 90,
                "app_points": 0,
                "currency": "GTQ",
                "points_conversion": 0
            },
            {
                "country_name": "Honduras",
                "country_id": 97,
                "app_points": 0,
                "currency": "HNL",
                "points_conversion": 0
            },
            {
                "country_name": "México",
                "country_id": 142,
                "app_points": 0,
                "currency": "MXN",
                "points_conversion": 0
            },
            {
                "country_name": "Panamá",
                "country_id": 170,
                "app_points": 0,
                "currency": "USD",
                "points_conversion": 0
            },
            {
                "country_name": "Perú",
                "country_id": 173,
                "app_points": 0,
                "currency": "PEN",
                "points_conversion": 0
            }
        ],
        endAmpm: "am",
        endTime: "2025-04-15T05:00:00.472Z",
        endDate: "2025-04-30T05:00:00.000Z",
        startAmpm: "am",
        startTime: "2025-04-15T05:00:00.722Z",
        startDate: "2025-04-14T05:00:00.000Z",
        full_members_text: null,
        mission_not_completed_text: "test",
        mission_completed_text: "test",
        app_end_text: "test",
        app_init_text: "tes",
        description: "",
        country_id: [
            48,
            62,
            64,
            66,
            90,
            97,
            142,
            170,
            173
        ],
        project_id: 1817,
        name: "test multi estres",
        status: "in_course",
        end_date: "2025-04-30 00:00:00",
        init_date: "2025-04-14 00:00:00",
        groups: [
            {
                "id": 1946,
                "type": "MembeerGroup"
            }
        ],
        tools: [
          step2DataId
        ]
    });
    const step5Res = http.post(step5Url, step5Payload, { headers: commonHeaders });

     if (!check(step5Res, { 'Setup - Paso 5 OK': (r) => r.status === 200 })) { // O el código de éxito esperado
        console.error(`Setup FAIL: Paso 5 fallido! Status: ${step5Res.status}, Body: ${step5Res.body}`);
        throw new Error('Setup fallido: Paso 5 fallido.');
    }
    console.log('Setup: Paso 5 completado.');

  }); // Fin del group('Setup')

  console.log('--- Setup Finalizado Exitosamente ---');
  console.log(`===> surveyId a usar por los usuarios: ${surveyIdForUsers}`);
  console.log(`===> questionId a usar por los usuarios: ${questionIdForUsers}`);

  // Devolver los datos que necesitan los VUs en la función default
  return {
    surveyId: surveyIdForUsers,
    questionId: questionIdForUsers
  };
}


// --- FUNCIÓN DEFAULT: Se ejecuta por cada VU para simular usuarios normales ---
export default function (data) {
  // Si no hay usuarios cargados (users.json vacío o inválido), no ejecutar este flujo.
  if (users.length === 0) {
    console.warn(`VU ${__VU}: Omitiendo ejecución de usuario normal - no hay datos de usuario cargados.`);
    sleep(1); // Evitar que el VU termine inmediatamente y cause problemas
    return;
  }

  // Obtener usuario normal (asegura que el índice sea válido)
  const userIndex = (__VU - 1) % users.length;
  const user = users[userIndex];

  let userToken = null;
  let loginOk = false;
  let surveyOk = false;

  // Grupo para Login de Usuario Normal (basado en tu script original)
  group('User Login', function() {
    const payload = JSON.stringify({
      email: user.email,
      password: user.password
    });
    const params = {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
         // TODO: Añade otros headers necesarios para el login de usuario si los hay
         'User-Agent': 'k6-test-script/1.0'
      },
      tags: { endpoint: 'User Login' } // Etiqueta para filtrar en resultados/InfluxDB
    };


    const startTime = new Date().getTime();
    const response = http.post(userLoginUrl, payload, params);
    const endTime = new Date().getTime();
    const duration = endTime - startTime;

    loginTime.add(duration); // Métrica

    loginOk = check(response, {
      'User Login successful (status 200)': (r) => r.status === 200,
      'User Login response contains auth_token': (r) => {
          if (r.status !== 200) return false;
          try {
            // TODO: AJUSTA el path JSON para extraer el token de usuario normal
            const token = r.json('data.auth_token');
            return token != null && token !== '';
          } catch (e) { return false; }
        }
    });

    loginSuccessRate.add(loginOk); // Métrica

    if (loginOk) {
      try {
        // TODO: AJUSTA el path JSON para extraer el token de usuario normal
        userToken = response.json('data.auth_token');
       console.log(`VU ${__VU}: ✅ Login exitoso para ${user.email} (${duration}ms)`);
      } catch (e) {
         console.log(`VU ${__VU}: ⚠️ Error extrayendo token post-login para ${user.email}: ${e}`);
         loginOk = false; // Marcar como fallo si no se puede extraer el token
      }
    } else {
      // console.log(`VU ${__VU}: ❌ Error en login para ${user.email}: ${response.status}`);
      // Contadores de error
      if (response.status === 403) error403Counter.add(1);
      else if (response.status === 404) error404Counter.add(1); // Aunque 404 es raro para login
      else if (response.status === 422) error422Counter.add(1);
      else if (response.status === 500) error500Counter.add(1);
    }
  });

  sleep(0.5); // Pausa breve

  // Grupo para Responder Encuesta (basado en tu script original)
  group('User Survey Response', function() {
    if (!loginOk || !userToken) {
       console.log(`VU ${__VU}: ⏩ Omitiendo encuesta para ${user.email}: login fallido o sin token.`);
      flowSuccessRate.add(0); // Flujo no completado
      return; // No continuar si el login falló
    }
    // Asegurarse que los datos de setup están disponibles
     if (!data || data.surveyId === undefined || data.questionId === undefined) {
       console.error(`VU ${__VU}: 🛑 ERROR CRÍTICO: No se recibieron los datos (surveyId, questionId) desde setup(). Omitiendo encuesta.`);
       flowSuccessRate.add(0);
       return;
     }


    // ¡Usar los IDs obtenidos del setup que se pasan en el objeto 'data'!
    const surveyPayload = JSON.stringify({
      survey_id: data.surveyId,     // <--- ID dinámico de setup
      type: "Binaria",              // <-- Valor estático (o ajústalo si es necesario)
      answer: "1",                  // <-- Valor estático (o ajústalo si es necesario)
      question_id: data.questionId  // <--- ID dinámico de setup
    });

    const params = {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${userToken}`,
        'Accept': 'application/json'
         // TODO: Añade otros headers necesarios si los hay
      },
      tags: { endpoint: 'Survey Answer' } // Etiqueta para filtrar en resultados/InfluxDB
    };

    const startTime = new Date().getTime();
    const response = http.post(userAnswerUrl, surveyPayload, params);
    const endTime = new Date().getTime();
    const duration = endTime - startTime;

    surveyTime.add(duration); // Métrica

    surveyOk = check(response, {
       'Survey Response successful (status 200)': (r) => r.status === 200,
       // TODO: Añade checks más específicos si la respuesta 200 tiene un body esperado
       // 'Survey Response body indicates success': (r) => r.status === 200 && r.json('success') === true,
    });

    surveySuccessRate.add(surveyOk); // Métrica

    if (surveyOk) {
      console.log(`VU ${__VU}: ✅ Encuesta respondida exitosamente para ${user.email} (${duration}ms)`);
    } else {
        console.log(`VU ${__VU}: ❌ Error al responder encuesta para ${user.email}: ${response.status}`);
       // Contadores de error
       if (response.status === 403) error403Counter.add(1); // Ej: Token inválido/expirado
       else if (response.status === 404) error404Counter.add(1); // Ej: Encuesta/pregunta no encontrada con esos IDs
       else if (response.status === 422) error422Counter.add(1); // Ej: Respuesta inválida (tipo, formato)
       else if (response.status === 500) error500Counter.add(1); // Error del servidor
    }
  });

  // Registrar éxito del flujo completo (login Y encuesta OK)
  flowSuccessRate.add(loginOk && surveyOk ? 1 : 0);

  // Log final del VU (opcional, puede generar mucho output)
   if (loginOk && surveyOk) {
    console.log(`VU ${__VU}: 🎉 Flujo completo exitoso para ${user.email}`);
   } else {
     console.log(`VU ${__VU}: ⚠️ Flujo incompleto para ${user.email} (Login: ${loginOk}, Survey: ${surveyOk})`);
  }
}

// --- FUNCIÓN HANDLESUMMARY: Genera un resumen al final ---
// (Simplificado para no usar el array 'results' que ya no aplica con setup)
export function handleSummary(data) {
  console.log('📊 Resumen de la prueba:');

  // Puedes añadir lógica personalizada aquí si necesitas procesar las métricas
  // Por ejemplo, calcular un % de éxito general basado en las tasas
  console.log(`📊 Generando informes con ${results.length} resultados`);
  // Genera un reporte HTML y muestra el resumen estándar en consola
  return {
    "summary.html": htmlReport(data, { title: `Reporte k6 Test - ${new Date().toISOString()}` })
  };
}
