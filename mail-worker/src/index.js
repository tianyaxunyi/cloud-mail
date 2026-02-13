import app from './hono/webs';
import { email } from './email/email';
import userService from './service/user-service';
import verifyRecordService from './service/verify-record-service';
import emailService from './service/email-service';
import kvObjService from './service/kv-obj-service';
import oauthService from "./service/oauth-service";

export default {
	async fetch(req, env, ctx) {
		const url = new URL(req.url);
		const corsHeaders = {
			"Access-Control-Allow-Origin": "*",
			"Access-Control-Allow-Methods": "POST, OPTIONS, GET",
			"Access-Control-Allow-Headers": "Content-Type, Authorization",
		};

		if (req.method === "OPTIONS") {
			return new Response(null, { headers: corsHeaders });
		}

		const isExternal = url.pathname === '/api/external/send';
		const isInternalUI = url.pathname.includes('/mail/send');

		if ((isExternal || isInternalUI) && req.method === 'POST') {
			if (isExternal) {
				const auth = req.headers.get("Authorization");
				if (auth !== `Bearer ${env.AUTH_KEY}`) {
					return new Response(JSON.stringify({ error: "Unauthorized" }), { 
						status: 401, headers: corsHeaders 
					});
				}
			}

			try {
				const body = await req.json();
				const sendData = {
					sender: { 
						email: body.from || body.fromEmail, 
						name: env.admin || "Cloud Mail Service" 
					},
					to: [{ email: body.to || body.toEmail }],
					subject: body.subject,
					htmlContent: body.content || body.htmlContent || body.text,
					attachment: body.attachments || [] 
				};

				const res = await fetch("https://api.brevo.com/v3/smtp/email", {
					method: "POST",
					headers: {
						"api-key": env.BREVO_API_KEY,
						"content-type": "application/json",
						"accept": "application/json"
					},
					body: JSON.stringify(sendData)
				});

				const result = await res.json();
				
				// 关键：如果 Brevo 返回错误，我们将错误详情返回给前端
				return new Response(JSON.stringify(result), { 
					status: 200, 
					headers: { "Content-Type": "application/json", ...corsHeaders }
				});
			} catch (err) {
				return new Response(JSON.stringify({ error: err.message }), { 
					status: 500, headers: corsHeaders 
				});
			}
		}

		if (url.pathname.startsWith('/api/')) {
			url.pathname = url.pathname.replace('/api', '');
			req = new Request(url.toString(), req);
			return app.fetch(req, env, ctx);
		}

		if (['/static/','/attachments/'].some(p => url.pathname.startsWith(p))) {
			return await kvObjService.toObjResp( { env }, url.pathname.substring(1));
		}

		return env.assets.fetch(req);
	},
	email: email,
	async scheduled(c, env, ctx) {
		await verifyRecordService.clearRecord({ env })
		await userService.resetDaySendCount({ env })
		await emailService.completeReceiveAll({ env })
		await oauthService.clearNoBindOathUser({ env })
	},
};
