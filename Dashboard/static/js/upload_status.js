function resetUploadStatusModal() {
	$('#uploadOk').hide();
	$('#uploadFailed').hide();
	$('#uploadOk .upload-status').text('配置已成功提交');
	$('#uploadFailed .upload-status').text('配置提交失敗');
}

function showUploadSuccess(message) {
	resetUploadStatusModal();
	$('#uploadOk .upload-status').text(message || '配置已成功提交');
	$('#uploadOk').show();
	$('#uploadStatus').modal('show');
}

function showUploadFailure(message) {
	resetUploadStatusModal();
	$('#uploadFailed .upload-status').text(message || '配置提交失敗');
	$('#uploadFailed').show();
	$('#uploadStatus').modal('show');
}

function showUploadSuccessThen(onHidden) {
	resetUploadStatusModal();
	$('#uploadOk .upload-status').text('配置已成功提交');
	$('#uploadOk').show();
	$('#uploadStatus').off('hidden.bs.modal.uploadStatusChain');
	if (onHidden) {
		$('#uploadStatus').one('hidden.bs.modal.uploadStatusChain', onHidden);
	}
	$('#uploadStatus').modal('show');
}
