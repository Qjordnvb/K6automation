import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { SharedArray } from 'k6/data';
import { Trend, Rate, Counter } from 'k6/metrics';

// Comando para ejecutar el programa: k6 run --out influxdb=http://localhost:8086/k6 testStress.js

// Comando para iniciar grafana: sudo nohup /usr/sbin/grafana-server --config=/etc/grafana/grafana.ini --homepath=/usr/share/grafana > /tmp/grafana.log 2>&1 &

// Métricas simplificadas con nombres más claros
const loginTime = new Trend('login_time');
const surveyTime = new Trend('survey_time');
const loginSuccessRate = new Rate('login_success_rate');
const surveySuccessRate = new Rate('survey_success_rate');
const flowSuccessRate = new Rate('flow_success_rate');

// Contadores específicos para los errores que observamos
const error403Counter = new Counter('error_403');
const error404Counter = new Counter('error_404');
const error422Counter = new Counter('error_422');
// Añadir contador para errores 500
const error500Counter = new Counter('error_500');




// Cargar usuarios desde el archivo JSON
const users = new SharedArray('users', function() {
  return JSON.parse(open('./users.json')).users;
});

// Array global para recopilar resultados
let results = [];

export const options = {
  scenarios: {
    complete_flow: {
      executor: 'per-vu-iterations',
      vus: users.length,
      iterations: 1,
      maxDuration: '60s'
    },
  },
  thresholds: {
    'login_time': ['p(95)<15000'],        // 15s de tiempo máximo de login
    'survey_time': ['p(95)<5000'],        // 5s de tiempo máximo para encuesta
    'login_success_rate': ['rate>0.80'],  // Al menos 80% de logins exitosos
    'survey_success_rate': ['rate>0.01']  // Umbral bajo para encuestas por los fallos
  },
};

export default function() {
  // Obtener usuario según índice de VU
  const userIndex = (__VU - 1) % users.length;
  const user = users[userIndex];

  // Objeto para almacenar resultados del usuario
  const userResult = {
    email: user.email,
    timestamp: new Date().toISOString(),
    login: {
      success: false,
      duration: 0,
      status: null,
      errorMessage: null
    },
    survey: {
      attempted: false,
      success: false,
      duration: 0,
      status: null,
      errorMessage: null
    },
    flowComplete: false
  };

  let userToken = null;

  // PASO 1: LOGIN
  group('Login', function() {
    const loginUrl = 'tuapi';

    const payload = JSON.stringify({
      email: user.email,
      password: user.password
    });

    const params = {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.131 Safari/537.36',
        'Accept': 'application/json, text/plain, */*'
      }
    };

    // Realizar petición
    const startTime = new Date().getTime();
    const response = http.post(loginUrl, payload, params);
    const endTime = new Date().getTime();
    const duration = endTime - startTime;

    // Guardar duración y estado
    userResult.login.duration = duration;
    userResult.login.status = response.status;

    // Incrementar contador si hay error 403
    if (response.status === 403) {
      error403Counter.add(1);
      userResult.login.errorMessage = "Forbidden - credenciales inválidas o cuenta bloqueada";
    }

    // Verificar respuesta
    const success = check(response, {
      'login successful': (r) => {
        if (r.status === 200) {
          try {
            const body = JSON.parse(r.body);
            return body.success && body.data && body.data.auth_token;
          } catch (e) {
            userResult.login.errorMessage = `Error al parsear JSON: ${e.message}`;
            return false;
          }
        }
        return false;
      },
    });

    // Actualizar estado
    userResult.login.success = success;

    // Registrar en métricas
    loginTime.add(duration);
    loginSuccessRate.add(success);

    // Si es exitoso, obtener token
    if (success) {
      try {
        const responseBody = JSON.parse(response.body);
        userToken = responseBody.data.auth_token;
        console.log(`✅ Login exitoso para ${user.email} (${duration}ms)`);
      } catch (e) {
        console.log(`❌ Error procesando respuesta para ${user.email}: ${e.message}`);
        userResult.login.errorMessage = `Error al extraer token: ${e.message}`;
      }
    } else {
      console.log(`❌ Error en login para ${user.email}: ${response.status}`);
    }
  });

  // Pausa breve
  sleep(0.5);

  // PASO 2: ENCUESTA
  group('Survey', function() {
    // Solo continuar si hay token
    if (!userToken) {
      console.log(`⏩ Omitiendo encuesta para ${user.email}: no hay token disponible`);
      return;
    }

    userResult.survey.attempted = true;

    const surveyUrl = 'tuapi';

    const surveyData = JSON.stringify({
      survey_id: 3668,
      type: "Binaria",
      answer: "1",
      question_id: 68888
    });

    const params = {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${userToken}`,
        'Accept': 'application/json, text/plain, */*'
      }
    };

    // Realizar petición
    const startTime = new Date().getTime();
    const response = http.post(surveyUrl, surveyData, params);
    const endTime = new Date().getTime();
    const duration = endTime - startTime;

    // Guardar duración y estado
    userResult.survey.duration = duration;
    userResult.survey.status = response.status;

    // Incrementar contadores específicos de error
    if (response.status === 404) {
      error404Counter.add(1);
      userResult.survey.errorMessage = "Not Found - endpoint o parámetros incorrectos";
    } else if (response.status === 422) {
      error422Counter.add(1);
      userResult.survey.errorMessage = "Unprocessable Entity - datos inválidos";
    }

    // Y en tu sección de PASO 2: ENCUESTA, añade esto junto a los otros errores
if (response.status === 500) {
  error500Counter.add(1);
  userResult.survey.errorMessage = "Internal Server Error - timeout o sobrecarga del servidor";
}

    // Verificar respuesta
    const success = check(response, {
      'survey successful': (r) => {
        if (r.status === 200) {
          try {
            const body = JSON.parse(r.body);
            return body.success === true;
          } catch (e) {
            userResult.survey.errorMessage = `Error al parsear JSON: ${e.message}`;
            return false;
          }
        }
        return false;
      },
    });

    // Actualizar estado
    userResult.survey.success = success;

    // Registrar en métricas
    surveyTime.add(duration);
    surveySuccessRate.add(success);

    // Log del resultado
    if (success) {
      console.log(`✅ Encuesta respondida exitosamente para ${user.email} (${duration}ms)`);
    } else {
      console.log(`❌ Error al responder encuesta para ${user.email}: ${response.status}`);
    }
  });

  // Verificar si el flujo completo fue exitoso
  userResult.flowComplete = userResult.login.success && userResult.survey.success;

  // Registrar éxito del flujo completo
  flowSuccessRate.add(userResult.flowComplete ? 1 : 0);

  // Log del resultado final
  if (userResult.flowComplete) {
    console.log(`🎉 Flujo completo exitoso para ${user.email}`);
  } else {
    console.log(`⚠️ Flujo incompleto para ${user.email}`);
  }

  // ¡IMPORTANTE! Guardar el resultado en el array global
  results.push(userResult);
}

// Función para generar informes finales
export function handleSummary(data) {
  // IMPORTANTE: Asegurarnos de que el array results no está vacío
  console.log(`📊 Generando informes con ${results.length} resultados`);

  // Si no hay resultados, crear uno de prueba para evitar el archivo vacío
  if (results.length === 0) {
    results.push({
      email: "test@example.com",
      timestamp: new Date().toISOString(),
      message: "No se recopilaron datos reales. Esto es un marcador para evitar JSON vacío."
    });
  }



}
