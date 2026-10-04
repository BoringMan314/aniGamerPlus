#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# @Time    : 2019/6/26 16:12
# @Author  : Miyouzi
# @File    : Server.py
# @Software: PyCharm

# 非阻塞（手動任務佇列須用 stdlib queue，不可在 patch 後 import，否則與 threading worker 互卡）
import queue as _stdlib_queue
from gevent import monkey; monkey.patch_all()
from gevent import sleep as gevent_sleep, spawn

import json, sys, os, re, time
import threading, traceback
import secrets

from aniGamerPlus import Config
from flask import Flask, request, jsonify
from flask import render_template
from flask_basicauth import BasicAuth
from aniGamerPlus import __cui as cui
import logging, termcolor
from ColorPrint import err_print
from logging.handlers import TimedRotatingFileHandler
import mimetypes
# ws 支援
import ssl
from flask_sockets import Sockets
from gevent.pywsgi import WSGIServer
from geventwebsocket.exceptions import WebSocketError
from geventwebsocket.handler import WebSocketHandler

mimetypes.add_type('text/css', '.css')
mimetypes.add_type('application/x-javascript', '.js')
template_path = os.path.join(Config.get_working_dir(), 'Dashboard', 'templates')
static_path = os.path.join(Config.get_working_dir(), 'Dashboard', 'static')
app = Flask(__name__, template_folder=template_path, static_folder=static_path)
app.debug = False
# Dashboard 模板/靜態檔常直接改磁碟內容；關閉快取避免必須重啟主程式才看得到按鈕
app.config['TEMPLATES_AUTO_RELOAD'] = True
app.jinja_env.auto_reload = True
app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 0
sockets = Sockets(app)

EXTENSION_ORIGIN_PREFIX = 'chrome-extension://'


def extension_response(data, status=200):
    response = jsonify(data)
    response.status_code = status
    origin = request.headers.get('Origin', '')
    if origin.startswith(EXTENSION_ORIGIN_PREFIX):
        response.headers['Access-Control-Allow-Origin'] = origin
        response.headers['Access-Control-Allow-Headers'] = 'Content-Type'
        response.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
        response.headers['Access-Control-Allow-Private-Network'] = 'true'
        response.headers['Vary'] = 'Origin'
    return response


def is_ani_gamer_cookie_name(name):
    return name in ('nologinuser', 'ckM', 'age_limit_content', 'avtrv') or name.startswith(('BAHA', 'MB_', 'ANIME_'))

# 日誌處理
# logger = logging.getLogger('werkzeug')
logger = logging.getLogger('geventwebsocket')
logging.basicConfig(level=logging.INFO)  # 記錄訪問
web_log_path = os.path.join(Config.get_working_dir(), 'logs', 'web.log')
handler = TimedRotatingFileHandler(filename=web_log_path, when='midnight', backupCount=7, encoding='utf-8')
handler.suffix = '%Y-%m-%d.log'
handler.extMatch = re.compile(r'^\d{4}-\d{2}-\d{2}.log')
logger.addHandler(handler)
logger.propagate = False  # 不在控制面板上輸出

# websocket 鑑權 token 池: 一次性、有時限, 且允許多個分頁同時各持一張
_ws_tokens = {}
_ws_tokens_lock = threading.Lock()
WS_TOKEN_TTL = 60  # 秒, 領取後須在此時間內完成 websocket 連線
WS_TOKEN_MAX = 64  # 上限, 防止有人狂打 /data/get_token 撐爆記憶體


def _purge_ws_tokens_locked(now):
    for expired in [t for t, issued in _ws_tokens.items() if now - issued > WS_TOKEN_TTL]:
        _ws_tokens.pop(expired, None)


def issue_ws_token():
    token = secrets.token_urlsafe(32)
    now = time.monotonic()
    with _ws_tokens_lock:
        _purge_ws_tokens_locked(now)
        while len(_ws_tokens) >= WS_TOKEN_MAX:
            _ws_tokens.pop(min(_ws_tokens, key=_ws_tokens.get), None)
        _ws_tokens[token] = now
    return token


def consume_ws_token(token):
    # 一次性核銷; 空值直接拒絕, 避免以 ?token= 命中已清空的舊 token
    if not token:
        return False
    now = time.monotonic()
    with _ws_tokens_lock:
        _purge_ws_tokens_locked(now)
        issued = _ws_tokens.pop(token, None)
    return issued is not None


_manual_task_queue = _stdlib_queue.Queue(maxsize=32)


def _manual_task_enqueue(raw):
    try:
        _manual_task_queue.put_nowait(raw)
    except _stdlib_queue.Full:
        err_print(0, 'Dashboard', '手動任務佇列已滿', no_sn=True, status=1)


def _process_manual_task_raw(raw):
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        err_print(0, 'Dashboard', '手動任務 JSON 格式錯誤', no_sn=True, status=1)
        return
    settings = Config.read_settings()

    if str(data.get('resolution', '')) not in ('360', '480', '540', '576', '720', '1080'):
        resolution = settings['download_resolution']
    else:
        resolution = str(data['resolution'])

    if data.get('mode') not in ('single', 'latest', 'all', 'resume', 'largest-sn'):
        mode = 'single'
    else:
        mode = data['mode']

    try:
        thread = int(data.get('thread') or 1)
    except (TypeError, ValueError):
        thread = 1
    thread_limit = max(1, min(thread, Config.get_max_multi_thread()))

    sn = str(data.get('sn', '')).strip()
    if not sn.isdigit():
        err_print(0, 'Dashboard', '手動任務 sn 不是數字, 已忽略: ' + sn[:50], no_sn=True, status=1)
        return

    err_print(0, 'Dashboard', '透過 Web 控制面板下達了手動任務', no_sn=True, status=2)
    cui(sn, resolution, mode, thread_limit, [], classify=bool(data.get('classify', True)),
        realtime_show=False, cui_danmu=bool(data.get('danmu', False)), dashboard_worker=True)


def _manual_task_worker():
    while True:
        raw = _manual_task_queue.get()
        job = threading.Thread(
            target=_process_manual_task_job,
            args=(raw,),
            daemon=True,
            name='manual-task-job')
        job.start()


def _process_manual_task_job(raw):
    try:
        _process_manual_task_raw(raw)
    except BaseException:
        logger.exception('手動任務處理失敗')
    finally:
        _manual_task_queue.task_done()


threading.Thread(target=_manual_task_worker, daemon=True, name='dashboard-manual-dispatcher').start()


# 處理 Flask 寫日誌到檔案帶有顏色控制符的問題
def colored(text, color=None, on_color=None, attrs=None):
    who_invoked = traceback.extract_stack()[-2][2]  # 函式呼叫人
    if who_invoked == 'log_request':
        # 如果是來自 Flask/werkzeug 的呼叫
        return text
    else:
        # 來自其他的呼叫正常高亮
        COLORS = termcolor.COLORS
        HIGHLIGHTS = termcolor.HIGHLIGHTS
        ATTRIBUTES = termcolor.ATTRIBUTES
        RESET = termcolor.RESET
        if os.getenv('ANSI_COLORS_DISABLED') is None:
            fmt_str = '\033[%dm%s'
            if color is not None:
                text = fmt_str % (COLORS[color], text)
            if on_color is not None:
                text = fmt_str % (HIGHLIGHTS[on_color], text)
            if attrs is not None:
                for attr in attrs:
                    text = fmt_str % (ATTRIBUTES[attr], text)
            text += RESET
        return text


termcolor.colored = colored
app.logger.addHandler(handler)


# 讀取web需要的配置名稱列表
id_list_path = os.path.join(Config.get_working_dir(), 'Dashboard', 'static', 'js', 'settings_id_list.js')
with open(id_list_path, 'r', encoding='utf-8') as f:
    id_list = re.sub(r'(var id_list\s*=\s*|\s*\n?)', '', f.read()).replace('\'', '"')
    id_list = json.loads(id_list)


@app.route('/')
def home():
    return render_template('index.html', active_page='settings')


@app.route('/monitor')
def monitor():
    return render_template('index.html', active_page='monitor')


@app.route('/api/extension/handshake', methods=['GET', 'OPTIONS'])
def extension_handshake():
    if request.method == 'OPTIONS':
        return extension_response({})
    return extension_response({'protocol': 1, 'cookieEndpoint': '/api/extension/cookie'})


@app.route('/api/extension/cookie', methods=['POST', 'OPTIONS'])
def extension_cookie():
    if request.method == 'OPTIONS':
        return extension_response({})

    data = request.get_json(silent=True)
    entries = data.get('entries') if isinstance(data, dict) else None
    if not isinstance(entries, list):
        return extension_response({'ok': False}, 400)

    cookies = {}
    for entry in entries:
        if not isinstance(entry, (list, tuple)) or len(entry) != 2:
            return extension_response({'ok': False}, 400)
        name, value = entry
        if not isinstance(name, str) or not isinstance(value, str) or not is_ani_gamer_cookie_name(name):
            return extension_response({'ok': False}, 400)
        if not value or '\r' in value or '\n' in value or ';' in value:
            return extension_response({'ok': False}, 400)
        cookies[name] = value

    if not cookies:
        return extension_response({'ok': False}, 400)
    try:
        Config.renew_cookies(cookies, log=False)
    except BaseException:
        logger.exception('擴充功能 Cookie 更新失敗')
        return extension_response({'ok': False}, 500)
    saved_cookies = Config.read_cookie(log=False) or {}
    if any(saved_cookies.get(name) != value for name, value in cookies.items()):
        return extension_response({'ok': False}, 500)
    err_print(0, '', 'Cookie：已從插件更新 cookie.txt', no_sn=True, status=2)
    return extension_response({'ok': True})


@app.route('/data/login_status', methods=['GET'])
def login_status_api():
    return jsonify(Config.get_login_status(for_dashboard=True))


@app.route('/data/config.json', methods=['GET'])
def config():
    settings = Config.read_settings()
    web_settings = {}
    for id in id_list:
        web_settings[id] = settings[id]  # 僅傳回 Web 所需的設定項

    return jsonify(web_settings)


@app.route('/uploadConfig', methods=['POST'])
def recv_config():
    data = json.loads(request.get_data(as_text=True))
    new_settings = Config.read_settings()
    for id in id_list:
        new_settings[id] = data[id]  # 更新配置
    Config.write_settings(new_settings)  # 儲存配置
    # 用落盤後重新正規化的設定套用到執行期, 避免把未經校驗的原始值(如 use_gost、超界併發數)帶進記憶體
    _apply_runtime_config_after_save(Config.read_settings())
    err_print(0, 'Dashboard', '透過 Web 控制面板更新了 config.json', no_sn=True, status=2)
    return '{"status":"200"}'


def _apply_runtime_config_after_save(new_settings):
    # 正常情況 __main__ 與 aniGamerPlus 已是同一個模組, 這裡去重以防仍有兩份實例
    applied = set()
    for mod_name in ('__main__', 'aniGamerPlus'):
        mod = sys.modules.get(mod_name)
        if mod is None or id(mod) in applied:
            continue
        if hasattr(mod, 'apply_runtime_settings'):
            applied.add(id(mod))
            mod.apply_runtime_settings(new_settings)


@app.route('/manualTask', methods=['POST'])
def manual_task():
    raw = request.get_data(as_text=True)
    threading.Thread(
        target=_manual_task_enqueue,
        args=(raw,),
        daemon=True,
        name='manual-task-enqueue').start()
    return jsonify({'status': '200'})


def _pipeline_module():
    # __main__ 與 aniGamerPlus 已別名為同一模組；優先取有控制函式的那個
    for mod_name in ('__main__', 'aniGamerPlus'):
        mod = sys.modules.get(mod_name)
        if mod is not None and hasattr(mod, 'cancel_task'):
            return mod
    import aniGamerPlus as mod
    return mod


@app.route('/task/pause_all', methods=['POST'])
def task_pause_all():
    mod = _pipeline_module()
    data = request.get_json(silent=True) or {}
    if data.get('resume'):
        mod.resume_all_tasks()
        paused = False
    else:
        mod.pause_all_tasks()
        paused = True
    return jsonify({'status': '200', 'paused': paused})


@app.route('/task/cancel_all', methods=['POST'])
def task_cancel_all():
    result = _pipeline_module().cancel_all_tasks()
    return jsonify({'status': '200', 'result': result})


@app.route('/task/cancel', methods=['POST'])
def task_cancel_one():
    data = request.get_json(silent=True) or {}
    sn = str(data.get('sn', '')).strip()
    if not sn.isdigit():
        return jsonify({'status': '400', 'error': 'invalid sn'}), 400
    ok = _pipeline_module().cancel_task(int(sn))
    return jsonify({'status': '200' if ok else '404', 'ok': ok})


@app.route('/data/sn_list', methods=['GET'])
def show_sn_list():
    return Config.get_sn_list_content()


@app.route('/data/get_token', methods=['GET'])
def get_token():
    # 每次領取都是獨立的一次性 token, 不會讓新分頁把既有分頁的 token 作廢
    return issue_ws_token(), '200 ok'


@sockets.route('/data/tasks_progress')
def tasks_progress(ws):
    # 鑑權
    if not consume_ws_token(request.args.get('token')):
        ws.send('Unauthorized')
        ws.close()
        return

    def push_progress(tick):
        if ws.closed:
            return
        body = {
            'tasks': Config.get_tasks_progress_rate(),
            'control': _pipeline_module().get_pipeline_control_state(),
        }
        if tick == 1 or tick % 10 == 0:
            body['login'] = Config.get_login_status(for_dashboard=True)
        else:
            body['login'] = dict(Config.login_status_cache)
        try:
            ws.send(json.dumps(body, ensure_ascii=False, separators=(',', ':')))
        except WebSocketError:
            try:
                ws.close()
            except BaseException:
                pass
        except OSError:
            try:
                ws.close()
            except BaseException:
                pass

    ws_tick = 0
    pending_push = None
    while not ws.closed:
        try:
            ws_tick += 1
            if pending_push is not None:
                if not pending_push.dead:
                    pending_push.kill()
                pending_push = None
            pending_push = spawn(push_progress, ws_tick)
        except WebSocketError:
            break
        except BaseException:
            logger.exception('tasks_progress WebSocket 推送失敗')
            break
        gevent_sleep(1)


@app.route('/sn_list', methods=['POST'])
def set_sn_list():
    data = request.get_data(as_text=True)
    Config.write_sn_list(data)
    err_print(0, 'Dashboard', '透過 Web 控制面板更新了 sn_list', no_sn=True, status=2)
    return '{"status":"200"}'


def run():
    settings = Config.read_settings()  # 讀取配置

    if settings['dashboard']['BasicAuth']:
        # BasicAuth 配置
        app.config['BASIC_AUTH_USERNAME'] = settings['dashboard']['username']  # BasicAuth user
        app.config['BASIC_AUTH_PASSWORD'] = settings['dashboard']['password']  # BasicAuth password
        app.config['BASIC_AUTH_FORCE'] = True  # 全站驗證
        basic_auth = BasicAuth(app)

    port = settings['dashboard']['port']
    host = settings['dashboard']['host']

    if settings['dashboard']['SSL']:
        # SSL 配置
        ssl_path = os.path.join(Config.get_working_dir(), 'Dashboard', 'sslkey')
        ssl_crt = os.path.join(ssl_path, 'server.crt')
        ssl_key = os.path.join(ssl_path, 'server.key')
        # ssl_keys = (ssl_crt, ssl_key)
        # app.run(use_reloader=False, port=port, host=host, ssl_context=ssl_keys)
        server = WSGIServer((host, port), app, handler_class=WebSocketHandler, certfile=ssl_crt, keyfile=ssl_key)

        wrap_socket = server.wrap_socket
        wrap_socket_and_handle = server.wrap_socket_and_handle

        # 處理一些瀏覽器(比如Chrome)嘗試 SSL v3 訪問時報錯
        def my_wrap_socket(sock, **_kwargs):
            try:
                # print('my_wrap_socket')
                return wrap_socket(sock, **_kwargs)
            except ssl.SSLError:
                # print('my_wrap_socket ssl.SSLError')
                pass

        # 此方法依賴上面的傳回值，因此當瀏覽器嘗試使用 SSL v3 連線時，此處也會發生錯誤
        def my_wrap_socket_and_handle(client_socket, address):
            try:
                # print('my_wrap_socket_and_handle')
                return wrap_socket_and_handle(client_socket, address)
            except AttributeError:
                # print('my_wrap_socket_and_handle AttributeError')
                pass

        server.wrap_socket = my_wrap_socket
        server.wrap_socket_and_handle = my_wrap_socket_and_handle

    else:
        # app.run(use_reloader=False, port=port, host=host)
        server = WSGIServer((host, port), app, handler_class=WebSocketHandler)

    server.serve_forever()


if __name__ == '__main__':
    run()
    pass
