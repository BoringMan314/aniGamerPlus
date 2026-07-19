layui.use('element', function(){
	let element = layui.element;

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
		let rate = Math.round(task.rate);
		return `
			<div class="layui-col-xs12 layui-card" id="${sn}">
				<div class="layui-card-header" style="height:auto !important;" id="header${sn}">${task.filename}</div>
				<div class="layui-card-body layui-row">
					<div class="layui-col-xs3" style="text-align: center;" id="status${sn}">${task.status}</div>
					<div class="layui-col-xs9" style="padding: 3px;">
						<div class="layui-progress layui-progress-big" lay-showpercent="true" lay-filter="${sn}">
							<div class="layui-progress-bar" lay-percent="${rate}%">
								<span class="layui-progress-text">${rate}%</span>
							</div>
						</div>
					</div>
				</div>
			</div>
		`;
	}

	function renderTasks(data) {
		let sns = Object.keys(data);
		if (sns.length === 0) {
			$('#no_task').show();
			$('#task_info_panel').empty();
			return;
		}

		$('#no_task').hide();
		sns.sort(function(a, b) {
			let orderA = statusOrder(data[a].status);
			let orderB = statusOrder(data[b].status);
			if (orderA !== orderB) {
				return orderA - orderB;
			}
			return parseInt(a, 10) - parseInt(b, 10);
		});

		let panel = $('#task_info_panel');
		for (let sn of sns) {
			if ($('#'+sn).length > 0) {
				$('#status'+sn).html(data[sn].status);
				$('#header'+sn).html(data[sn].filename);
				element.progress(sn, Math.round(data[sn].rate)+'%');
			} else {
				panel.append(buildTaskCard(sn, data[sn]));
			}
		}

		for (let sn of sns) {
			panel.append($('#'+sn));
		}
		element.render('progress');
	}

	let protocol = window.location.protocol;
	let wsProtocol = protocol.replace('http', 'ws');
	let tasks_progress_url = wsProtocol + '//' + window.location.host + '/data/tasks_progress' + '?token=';

	$.get('data/get_token', function(token){
		tasks_progress_url += token;

		let ws = new WebSocket(tasks_progress_url);
		ws.onmessage = function(evt){
			let data = $.parseJSON(evt.data);
			renderTasks(data);
		};
	});
});
