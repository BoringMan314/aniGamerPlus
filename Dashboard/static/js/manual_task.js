var manualTaskInited = false;

function initManualTaskModal() {
	if (!manualTaskInited) {
		$('#manual_classify, #manual_danmu').bootstrapSwitch();
		$('#manual_mode, #manual_resolution').selectpicker();
		manualTaskInited = true;
	}

	if (window.syncSettingControlWidths) {
		window.syncSettingControlWidths();
		setTimeout(function() {
			window.syncSettingControlWidths();
		}, 0);
	}

	$.getJSON('data/config.json', function(data) {
		$('#manual_thread_limit').val(data['multi-thread']);
	});
}

function flashManualSubmitOk() {
	var $btn = $('#manual_submit_btn');
	if (!$btn.length) {
		return;
	}
	$btn.prop('disabled', false).text('已提交');
	setTimeout(function() {
		if ($('#manualTasks').hasClass('show')) {
			$btn.text('提交');
		}
	}, 3000);
}

function readManualConfig() {
	var manualData = {};
	var link = $('#manual_link').val();
	if (link.length == 0) {
		alert('請輸入影片連結！');
		return;
	}

	// 允許貼完整網址或只填 sn，網址後綴的其他參數一併去掉
	var snMatch = /(?:[?&]sn=)?(\d+)\s*(?:&|$)/.exec(link.trim());
	if (!snMatch) {
		alert('無法從連結取得 sn，請確認網址或直接輸入數字 sn！');
		return;
	}
	manualData['sn'] = snMatch[1];
	manualData['mode'] = $('#manual_mode').val();
	manualData['resolution'] = $('#manual_resolution').val().replace('P', '');
	manualData['classify'] = $('#manual_classify').is(':checked');
	manualData['thread'] = $('#manual_thread_limit').val();
	manualData['danmu'] = $('#manual_danmu').is(':checked');

	// 樂觀提交：不等待伺服器，不入隊提示彈窗
	$('#manual_link').val('').focus();
	flashManualSubmitOk();
	if (window.refreshTaskMonitor) {
		window.refreshTaskMonitor();
	}

	$.ajax({
		url: '/manualTask',
		type: 'post',
		dataType: 'json',
		timeout: 0,
		headers: {
			'Content-Type': 'application/json;charset=utf-8'
		},
		contentType: 'application/json; charset=utf-8',
		data: JSON.stringify(manualData),
		success: function() {
			if (window.refreshTaskMonitor) {
				window.refreshTaskMonitor();
			}
		}
	});
}

$(function () {
	$('#manualTasks').on('show.bs.modal', initManualTaskModal);
	if (window.location.hash === '#manualTasks') {
		$('#manualTasks').modal('show');
	}
});
