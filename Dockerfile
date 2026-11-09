# 元空间舰船工具 —— 运行镜像（零第三方依赖）
FROM python:3.12-slim

LABEL org.opencontainers.image.title="fleet-tool" \
      org.opencontainers.image.version="1.4.0"

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    FT_HOST=0.0.0.0 \
    FT_PORT=8787 \
    FT_IDLE_EXIT=0 \
    FT_DATA=/data \
    TZ=Asia/Shanghai

WORKDIR /app

COPY server.py db.py engine.py schema.py util.py ./
COPY static ./static

RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import os,sys,urllib.request;p=os.environ.get('PORT') or os.environ.get('FT_PORT') or '8787';sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:'+p+'/api/health',timeout=4).status==200 else 1)"

CMD ["python", "-X", "utf8", "server.py"]