export async function onRequest(context) {
    const { request, env, params } = context;

    console.log('Test webhook received request:', {
        method: request.method,
        secret: params.secret,
        url: request.url
    });

    if (request.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
    }

    return new Response('OK - Test webhook working!', { status: 200 });
}