(function () {
	var monitorStarted = false;
	var ws = null;
	var reconnectTimer = null;
	var lastPayload = null;
	var lastDataKey = '';
	var renderTasks = null;
	var socketSilent = false;
	var socketConnecting = false;

	// 三個管線階段 + 結束清單, 順序即畫面由上而下的順序
	var sections = [
		{ key: 'downloading', id: 'downloading', rendered: '' },
		{ key: 'merging', id: 'merging', rendered: '' },
		{ key: 'queued', id: 'queued', rendered: '' },
		{ key: 'finished', id: 'finished', rendered: '' }
	];

	function stageOf(task) {
		switch (task.stage) {
			case 'downloading':
				return 'downloading';
			case 'merging':
				return 'merging';
			case 'done':
			case 'failed':
				return 'finished';
			case 'queued':
				return 'queued';
		}
		// 後端未提供 stage(舊版本)時退回以狀態文字判斷
		var status = task.status || '';
		if (status.indexOf('合併') !== -1) {
			return 'merging';
		}
		if (status.indexOf('正在下載') !== -1 || status.indexOf('正在移至') !== -1) {
			return 'downloading';
		}
		if (status.indexOf('完成') !== -1 || status.indexOf('任務失敗') !== -1) {
			return 'finished';
		}
		return 'queued';
	}

	function buildTaskCard(sn, task) {
		var rate = Math.round(task.rate);
		return (
			'<div class="layui-col-xs12 layui-card" id="task-' + sn + '">' +
				'<div class="layui-card-header" style="height:auto !important;" id="header-' + sn + '">' + task.filename + '</div>' +
				'<div class="layui-card-body layui-row">' +
					'<div class="layui-col-xs3" style="text-align: center;" id="status-' + sn + '">' + task.status + '</div>' +
					'<div class="layui-col-xs9" style="padding: 3px;">' +
						'<div class="layui-progress layui-progress-big" lay-showpercent="true" lay-filter="task-' + sn + '">' +
							'<div class="layui-progress-bar" lay-percent="' + rate + '%">' +
								'<span class="layui-progress-text">' + rate + '%</span>' +
							'</div>' +
						'</div>' +
					'</div>' +
				'</div>' +
			'</div>'
		);
	}

	function applyTaskProgress(sn, rate, element) {
		var percent = Math.round(rate) + '%';
		var bar = $('#task-' + sn).find('.layui-progress-bar');
		bar.attr('lay-percent', percent);
		bar.find('.layui-progress-text').text(percent);
		element.progress('task-' + sn, percent);
	}

	function showMonitorLoading() {
		$('#monitor_loading').show();
		$('#no_task').hide();
	}

	function hideMonitorLoading() {
		$('#monitor_loading').hide();
	}

	function resetSections() {
		for (var i = 0; i < sections.length; i++) {
			sections[i].rendered = '';
			$('#panel_' + sections[i].id).empty();
			$('#section_' + sections[i].id).hide();
		}
		lastDataKey = '';
	}

	function parseProgressPayload(raw) {
		if (!raw || raw === 'Unauthorized') {
			return null;
		}
		try {
			return JSON.parse(raw);
		} catch (e) {
			return null;
		}
	}

	function extractTasksAndLogin(payload) {
		if (!payload) {
			return { tasks: null, login: null };
		}
		if (payload.tasks !== undefined) {
			return { tasks: payload.tasks, login: payload.login || null };
		}
		return { tasks: payload, login: null };
	}

	function scheduleReconnect() {
		if (reconnectTimer) {
			return;
		}
		if (!socketSilent) {
			showMonitorLoading();
		}
		reconnectTimer = setTimeout(function () {
			reconnectTimer = null;
			connectTaskProgress({ silent: socketSilent });
		}, 2000);
	}

	function connectTaskProgress(options) {
		options = options || {};
		socketSilent = !!options.silent;
		if (socketConnecting || (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN))) {
			return;
		}
		socketConnecting = true;
		if (ws) {
			// 先拆掉回呼再關閉, 這次關閉不會觸發重連, 也不會影響下一條連線的斷線偵測
			try {
				ws.onclose = null;
				ws.onerror = null;
				ws.onmessage = null;
				ws.close();
			} catch (e) {}
			ws = null;
		}

		var protocol = window.location.protocol;
		var wsProtocol = protocol.replace('http', 'ws');
		var tasksProgressUrl = wsProtocol + '//' + window.location.host + '/data/tasks_progress?token=';

		$.get('/data/get_token')
			.done(function (token) {
				if (!token) {
					socketConnecting = false;
					scheduleReconnect();
					return;
				}
				var socket = new WebSocket(tasksProgressUrl + encodeURIComponent(token));
				ws = socket;

				socket.onopen = function () {
					socketConnecting = false;
					hideMonitorLoading();
				};

				socket.onmessage = function (evt) {
					var payload = parseProgressPayload(evt.data);
					if (!payload) {
						scheduleReconnect();
						return;
					}
					hideMonitorLoading();
					var parts = extractTasksAndLogin(payload);
					if (parts.login && window.applyLoginStatusBadge) {
						window.applyLoginStatusBadge(parts.login);
					}
					if (!parts.tasks) {
						return;
					}
					lastPayload = parts.tasks;
					if ($('#page-monitor').is(':visible') && renderTasks) {
						renderTasks(lastPayload);
					}
				};

				socket.onerror = function () {
					socketConnecting = false;
					scheduleReconnect();
				};

				socket.onclose = function () {
					socketConnecting = false;
					scheduleReconnect();
				};
			})
			.fail(function () {
				socketConnecting = false;
				scheduleReconnect();
			});
	}

	window.ensureTaskProgressSocket = function () {
		connectTaskProgress({ silent: true });
	};

	window.refreshTaskMonitor = function () {
		if (lastPayload && $('#page-monitor').is(':visible') && renderTasks) {
			resetSections();
			renderTasks(lastPayload);
		}
	};

	window.startTaskMonitor = function () {
		if (typeof layui === 'undefined') {
			showMonitorLoading();
			scheduleReconnect();
			return;
		}

		if (monitorStarted) {
			window.refreshTaskMonitor();
			return;
		}
		monitorStarted = true;
		showMonitorLoading();

		layui.use('element', function () {
			var element = layui.element;

			function renderSection(section, snList, data) {
				var panel = $('#panel_' + section.id);
				$('#count_' + section.id).text(snList.length);

				if (snList.length === 0) {
					if (section.rendered !== '') {
						panel.empty();
						section.rendered = '';
					}
					$('#section_' + section.id).hide();
					return false;
				}
				$('#section_' + section.id).show();

				var membership = snList.join(',');
				var rebuilt = membership !== section.rendered;
				if (rebuilt) {
					// 成員有增減才整區重建, 否則只就地更新文字與進度, 避免進度條閃爍
					panel.empty();
					for (var i = 0; i < snList.length; i++) {
						panel.append(buildTaskCard(snList[i], data[snList[i]]));
					}
					section.rendered = membership;
				} else {
					for (var j = 0; j < snList.length; j++) {
						var sn = snList[j];
						var task = data[sn];
						var statusNode = $('#status-' + sn);
						if (statusNode.text() !== task.status) {
							statusNode.text(task.status);
						}
						var headerNode = $('#header-' + sn);
						if (headerNode.text() !== task.filename) {
							headerNode.text(task.filename);
						}
					}
				}

				for (var k = 0; k < snList.length; k++) {
					applyTaskProgress(snList[k], data[snList[k]].rate, element);
				}
				return rebuilt;
			}

			renderTasks = function (data) {
				var dataKey = JSON.stringify(data);
				if (dataKey === lastDataKey) {
					return;
				}
				lastDataKey = dataKey;

				var buckets = { queued: [], downloading: [], merging: [], finished: [] };
				var sns = Object.keys(data);
				for (var i = 0; i < sns.length; i++) {
					buckets[stageOf(data[sns[i]])].push(sns[i]);
				}

				hideMonitorLoading();
				if (sns.length === 0) {
					$('#no_task').show();
				} else {
					$('#no_task').hide();
				}

				var needRender = false;
				for (var s = 0; s < sections.length; s++) {
					var section = sections[s];
					// 同一區塊內固定用 sn 排序, 狀態文字變動不會造成順序跳動
					buckets[section.key].sort(function (a, b) {
						return parseInt(a, 10) - parseInt(b, 10);
					});
					if (renderSection(section, buckets[section.key], data)) {
						needRender = true;
					}
				}

				if (needRender) {
					element.render('progress');
				}
			};

			connectTaskProgress({ silent: false });
		});
	};
})();
