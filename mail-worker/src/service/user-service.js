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

        // 1. 解决跨域预检
        if (req.method === "OPTIONS") {
            return new Response(null, { headers: corsHeaders });
        }

        // 2. 强力拦截发信路径：跳过内部 501 校验逻辑
        const isExternal = url.pathname === '/api/external/send';
        const isInternalUI = url.pathname.includes('/mail/send');

        if ((isExternal || isInternalUI) && req.method === 'POST') {
            // 仅对外部 API 校验 woshinibaba，内部 UI 直接放行
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
                    subject: body.subject || "No Subject",
                    htmlContent: body.content || body.htmlContent || body.text || "",
                    attachment: body.attachments || [] 
                };

                const res = await fetch("https://api.brevo.com/v3/smtp/email", {
                    method: "POST",
                    headers: {
                        "api-key": env.BREVO_API_KEY,
                        "content-type": "application/json"
                    },
                    body: JSON.stringify(sendData)
                });

                const result = await res.json();
                
                // 强制返回 200，防止 UI 拦截 Brevo 的响应信息并报错
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

        // 3. 原有管理后台逻辑 (由于上面已拦截，发信请求不会走到这里)
        if (url.pathname.startsWith('/api/')) {
            url.pathname = url.pathname.replace('/api', '');
            req = new Request(url.toString(), req);
            return app.fetch(req, env, ctx);
        }

        // 4. 附件预览逻辑 (支持 R2 中图片/视频的读取)
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
