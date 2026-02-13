import app from './hono/webs';
import { email } from './email/email';
import userService from './service/user-service';
import verifyRecordService from './service/verify-record-service';
import emailService from './service/email-service';
import kvObjService from './service/kv-obj-service';
import oauthService from "./service/oauth-service";

export default {
	async fetch(req, env, ctx) {
		const url = new URL(req.url)// --- 1. 处理 CORS 预检请求 (解决 Failed to fetch 的核心) ---
        if (req.method === "OPTIONS") {
            return new Response(null, {
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "POST, OPTIONS",
                    "Access-Control-Allow-Headers": "Content-Type, Authorization",
                    "Access-Control-Max-Age": "86400",
                }
            });
        }

        // --- 2. 外部发信接口逻辑 ---
        if (url.pathname === '/api/external/send' && req.method === 'POST') {
            const auth = req.headers.get("Authorization");
            if (auth !== `Bearer ${env.AUTH_KEY}`) {
                return new Response(JSON.stringify({ error: "Unauthorized" }), { 
                    status: 401,
                    headers: { "Access-Control-Allow-Origin": "*" } 
                });
            }

            try {
                const body = await req.json();
                const res = await fetch("https://api.brevo.com/v3/smtp/email", {
                    method: "POST",
                    headers: {
                        "api-key": env.BREVO_API_KEY,
                        "content-type": "application/json",
                        "accept": "application/json"
                    },
                    body: JSON.stringify({
                        sender: { 
                            email: body.fromEmail, 
                            name: body.fromName || "Cloud Mail Service" 
                        },
                        to: [{ email: body.toEmail }],
                        subject: body.subject,
                        htmlContent: body.htmlContent || body.text,
                        // 转发附件：Brevo 限制单次 10MB
                        attachment: body.attachments 
                    })
                });

                const result = await res.json();
                // 返回结果时必须带上 CORS 头
                return new Response(JSON.stringify(result), { 
                    status: res.status,
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

        // --- 3. 原有逻辑：管理后台 API ---
        if (url.pathname.startsWith('/api/')) {
            url.pathname = url.pathname.replace('/api', '')
            req = new Request(url.toString(), req)
            return app.fetch(req, env, ctx);
        }

        // --- 4. 原有逻辑：读取 R2 中的图片/视频附件 ---
        if (['/static/','/attachments/'].some(p => url.pathname.startsWith(p))) {
            return await kvObjService.toObjResp({ env }, url.pathname.substring(1));
        }

        return env.assets.fetch(req);
    },
    // ... 后续的 email 绑定和 scheduled 保持不变
};
	email: email,
	async scheduled(c, env, ctx) {
		await verifyRecordService.clearRecord({ env })
		await userService.resetDaySendCount({ env })
		await emailService.completeReceiveAll({ env })
		await oauthService.clearNoBindOathUser({ env })
	},
};
