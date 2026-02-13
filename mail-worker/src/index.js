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

		// 1. 强制处理所有 OPTIONS 请求 (解决 CORS 和 Mixed Content 预检)
		if (req.method === "OPTIONS") {
			return new Response(null, {
				headers: {
					"Access-Control-Allow-Origin": "*",
					"Access-Control-Allow-Methods": "POST, OPTIONS, GET",
					"Access-Control-Allow-Headers": "Content-Type, Authorization",
					"Access-Control-Max-Age": "86400",
				}
			});
		}

		// 2. 拦截发信路由：无论是外部调用还是 UI 内部点击发送
		const isExternal = url.pathname === '/api/external/send';
		const isInternalUI = url.pathname === '/api/mail/send';

		if ((isExternal || isInternalUI) && req.method === 'POST') {
			if (isExternal) {
				const auth = req.headers.get("Authorization");
				if (auth !== `Bearer ${env.AUTH_KEY}`) {
					return new Response(JSON.stringify({ error: "Unauthorized" }), { 
						status: 401, headers: { "Access-Control-Allow-Origin": "*" } 
					});
				}
			}

			try {
				const body = await req.json();
				
				// 参数适配：UI 传 from/to/content，外部 API 传 fromEmail/toEmail/htmlContent
				const sendData = {
					sender: { 
						email: isInternalUI ? body.from : body.fromEmail, 
						name: env.admin || "Cloud Mail" 
					},
					to: [{ email: isInternalUI ? body.to : body.toEmail }],
					subject: body.subject,
					htmlContent: isInternalUI ? body.content : (body.htmlContent || body.text),
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
				
				// 返回 200 成功状态码给 UI，防止界面弹出错误
				return new Response(JSON.stringify(result), { 
					status: 200, 
					headers: { 
						"Content-Type": "application/json", 
						"Access-Control-Allow-Origin": "*" 
					}
				});
			} catch (err) {
				return new Response(JSON.stringify({ error: err.message }), { 
					status: 500, 
					headers: { "Access-Control-Allow-Origin": "*" } 
				});
			}
		}

		// 3. 原有管理后台逻辑 (跳过已拦截的发信请求)
		if (url.pathname.startsWith('/api/')) {
			url.pathname = url.pathname.replace('/api', '');
			req = new Request(url.toString(), req);
			return app.fetch(req, env, ctx);
		}

		// 4. 静态资源与 R2 附件读取 (用于显示收到的图片/视频)
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
