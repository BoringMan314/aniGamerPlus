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

function setManualSubmitBusy(busy) {
	var $btn = $('#manual_submit_btn');
	if (!$btn.length) {
		return;
	}
	if (busy) {
		$btn.prop('disabled', true).data('orig-text', $btn.text()).text('提交中…');
	} else {
		var orig = $btn.data('orig-text') || '提交';
		$btn.prop('disabled', false).text(orig);
	}
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
	}, 1200);
}

function readManualConfig() {
	var manualData = {};
	var link = $('#manual_link').val();
	if (link.length == 0) {
		alert('請輸入影片連結！');
		return;
	}

	manualData['sn'] = link.replace(/(https:\/\/)?ani\.gamer\.com\.tw\/animeVideo\.php\?sn=/i, '');
	manualData['mode'] = $('#manual_mode').val();
	manualData['resolution'] = $('#manual_resolution').val().replace('P', '');
	manualData['classify'] = $('#manual_classify').is(':checked');
	manualData['thread'] = $('#manual_thread_limit').val();
	manualData['danmu'] = $('#manual_danmu').is(':checked');

	setManualSubmitBusy(true);

	$.ajax({
		url: '/manualTask',
		type: 'post',
		dataType: 'json',
		timeout: 8000,
		headers: {
			'Content-Type': 'application/json;charset=utf-8'
		},
		contentType: 'application/json; charset=utf-8',
		data: JSON.stringify(manualData),
		success: function(data) {
			$('#manual_link').val('').focus();
			flashManualSubmitOk();
			if (window.refreshTaskMonitor) {
				window.refreshTaskMonitor();
			}
		},
		error: function(xhr) {
			setManualSubmitBusy(false);
			resetUploadStatusModal();
			var msg = '任務提交失敗';
			if (xhr && xhr.status === 503) {
				msg = '手動任務佇列已滿，請稍後再試';
			} else if (xhr && xhr.statusText === 'timeout') {
				msg = '伺服器回應逾時，任務可能已入隊，請看監控或 log';
			}
			$('#uploadFailed .upload-status').text(msg);
			$('#uploadFailed').show();
			$('#uploadStatus').off('hidden.bs.modal.uploadStatusChain');
			$('#uploadStatus').one('hidden.bs.modal.uploadStatusChain', function() {
				$('#uploadFailed .upload-status').text('配置提交失敗');
				$('#manualTasks').modal('show');
			});
			$('#uploadStatus').modal('show');
		}
	});
}

$(function () {
	$('#manualTasks').on('show.bs.modal', initManualTaskModal);
	if (window.location.hash === '#manualTasks') {
		$('#manualTasks').modal('show');
	}
});
