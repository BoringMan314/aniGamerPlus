(function () {
	var monitorStarted = false;
	var ws = null;
	var reconnectTimer = null;
	var intentionalClose = false;
	var lastPayload = null;
	var lastDataKey = '';
	var lastSortKey = '';
	var renderTasks = null;

	function statusOrder(status) {
		if (status.indexOf('正在') !== -1 || status.indexOf('失敗! 重啟') !== -1) {
			return 0;
		}
		if (status === '等待下載') {
			return 1;
		}
		if (status === '下載完成') {
			return 2;
		}
		return 3;
	}

	function buildTaskCard(sn, task) {
		var rate = Math.round(task.rate);
		return (
			'<div class="layui-col-xs12 layui-card" id="' + sn + '">' +
				'<div class="layui-card-header" style="height:auto !important;" id="header' + sn + '">' + task.filename + '</div>' +
				'<div class="layui-card-body layui-row">' +
					'<div class="layui-col-xs3" style="text-align: center;" id="status' + sn + '">' + task.status + '</div>' +
					'<div class="layui-col-xs9" style="padding: 3px;">' +
						'<div class="layui-progress layui-progress-big" lay-showpercent="true" lay-filter="' + sn + '">' +
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
		var bar = $('#' + sn).find('.layui-progress-bar');
		bar.attr('lay-percent', percent);
		bar.find('.layui-progress-text').text(percent);
		element.progress(sn, percent);
	}

	function showMonitorLoading() {
		$('#monitor_loading').show();
		$('#no_task').hide();
	}

	function hideMonitorLoading() {
		$('#monitor_loading').hide();
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

	function scheduleReconnect() {
		if (reconnectTimer) {
			return;
		}
		showMonitorLoading();
		reconnectTimer = setTimeout(function () {
			reconnectTimer = null;
			connectTaskProgress();
		}, 2000);
	}

	function connectTaskProgress() {
		if (ws) {
			intentionalClose = true;
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
				tasksProgressUrl += token;
				ws = new WebSocket(tasksProgressUrl);

				ws.onopen = function () {
					hideMonitorLoading();
				};

				ws.onmessage = function (evt) {
					var data = parseProgressPayload(evt.data);
					if (!data) {
						scheduleReconnect();
						return;
					}
					lastPayload = data;
					if ($('#page-monitor').is(':visible') && renderTasks) {
						renderTasks(lastPayload);
					}
				};

				ws.onerror = function () {
					scheduleReconnect();
				};

				ws.onclose = function () {
					if (intentionalClose) {
						intentionalClose = false;
						return;
					}
					scheduleReconnect();
				};
			})
			.fail(function () {
				scheduleReconnect();
			});
	}

	window.refreshTaskMonitor = function () {
		if (lastPayload && $('#page-monitor').is(':visible') && renderTasks) {
			lastDataKey = '';
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

			renderTasks = function (data) {
				var sns = Object.keys(data);
				var dataKey = JSON.stringify(data);
				if (dataKey === lastDataKey) {
					return;
				}
				lastDataKey = dataKey;

				if (sns.length === 0) {
					hideMonitorLoading();
					$('#no_task').show();
					$('#task_info_panel').empty();
					lastSortKey = '';
					return;
				}

				hideMonitorLoading();
				$('#no_task').hide();
				sns.sort(function (a, b) {
					var orderA = statusOrder(data[a].status);
					var orderB = statusOrder(data[b].status);
					if (orderA !== orderB) {
						return orderA - orderB;
					}
					return parseInt(a, 10) - parseInt(b, 10);
				});

				var sortKey = sns.join(',');
				var panel = $('#task_info_panel');
				var needRender = false;

				for (var i = 0; i < sns.length; i++) {
					var sn = sns[i];
					var task = data[sn];
					var card = $('#' + sn);
					if (card.length > 0) {
						if ($('#status' + sn).text() !== task.status) {
							$('#status' + sn).text(task.status);
						}
						if ($('#header' + sn).text() !== task.filename) {
							$('#header' + sn).text(task.filename);
						}
						applyTaskProgress(sn, task.rate, element);
					} else {
						panel.append(buildTaskCard(sn, task));
						needRender = true;
					}
				}

				if (sortKey !== lastSortKey) {
					for (var j = 0; j < sns.length; j++) {
						panel.append($('#' + sns[j]));
					}
					lastSortKey = sortKey;
					needRender = true;
				}

				if (needRender) {
					for (var k = 0; k < sns.length; k++) {
						applyTaskProgress(sns[k], data[sns[k]].rate, element);
					}
					element.render('progress');
				}
			};

			connectTaskProgress();
		});
	};
})();
