$ErrorActionPreference = 'Stop'

$results = @()

function Add-Result {
  param(
    [string]$Name,
    [bool]$Pass,
    [string]$Detail
  )

  $script:results += [pscustomobject]@{
    Test = $Name
    Pass = $Pass
    Detail = $Detail
  }
}

$productCases = @(
  @{ name = 'missing-name'; body = @{ category = 'c'; price = 1; stock = 1 } },
  @{ name = 'nan-price'; body = @{ name = 'p'; category = 'c'; price = 'abc'; stock = 1 } },
  @{ name = 'neg-price'; body = @{ name = 'p'; category = 'c'; price = -1; stock = 1 } },
  @{ name = 'nan-stock'; body = @{ name = 'p'; category = 'c'; price = 1; stock = 'abc' } },
  @{ name = 'neg-stock'; body = @{ name = 'p'; category = 'c'; price = 1; stock = -1 } }
)

foreach ($case in $productCases) {
  try {
    Invoke-RestMethod -Method POST -Uri 'http://localhost:8080/api/products' -ContentType 'application/json' -Body ($case.body | ConvertTo-Json) | Out-Null
    Add-Result -Name "product-$($case.name)" -Pass $false -Detail 'expected 400 got 2xx'
  } catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Add-Result -Name "product-$($case.name)" -Pass ($statusCode -eq 400) -Detail "status=$statusCode"
  }
}

$validProduct = Invoke-RestMethod -Method POST -Uri 'http://localhost:8080/api/products' -ContentType 'application/json' -Body (@{ name = 'strict-test'; category = 'strict'; price = 10; stock = 2 } | ConvertTo-Json)
$productId = [int]$validProduct.productId

$orderCases = @(
  @{ name = 'missing-items'; body = @{ customerId = 1 } },
  @{ name = 'empty-items'; body = @{ customerId = 1; items = @() } },
  @{ name = 'nan-customer'; body = @{ customerId = 'abc'; items = @(@{ productId = $productId; quantity = 1; price = 10 }) } },
  @{ name = 'nan-price'; body = @{ customerId = 1; items = @(@{ productId = $productId; quantity = 1; price = 'abc' }) } },
  @{ name = 'neg-price'; body = @{ customerId = 1; items = @(@{ productId = $productId; quantity = 1; price = -1 }) } },
  @{ name = 'zero-qty'; body = @{ customerId = 1; items = @(@{ productId = $productId; quantity = 0; price = 10 }) } },
  @{ name = 'missing-product'; body = @{ customerId = 1; items = @(@{ productId = 999999; quantity = 1; price = 10 }) } },
  @{ name = 'insufficient-stock'; body = @{ customerId = 1; items = @(@{ productId = $productId; quantity = 999; price = 10 }) } }
)

foreach ($case in $orderCases) {
  try {
    Invoke-RestMethod -Method POST -Uri 'http://localhost:8080/api/orders' -ContentType 'application/json' -Body ($case.body | ConvertTo-Json -Depth 5) | Out-Null
    Add-Result -Name "order-$($case.name)" -Pass $false -Detail 'expected 400 got 2xx'
  } catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Add-Result -Name "order-$($case.name)" -Pass ($statusCode -eq 400) -Detail "status=$statusCode"
  }
}

$sync = Invoke-RestMethod -Method GET -Uri 'http://localhost:8081/api/analytics/sync-status'
$hasKeys = ($sync.PSObject.Properties.Name -contains 'lastProcessedEventTimestamp') -and ($sync.PSObject.Properties.Name -contains 'lagSeconds')
$lagNumeric = ($sync.lagSeconds -is [int]) -or ($sync.lagSeconds -is [long]) -or ($sync.lagSeconds -is [double])
Add-Result -Name 'sync-shape' -Pass ($hasKeys -and $lagNumeric) -Detail ("keys=$hasKeys lagType=" + $sync.lagSeconds.GetType().Name)

$results | Format-Table -AutoSize | Out-String | Write-Output

if (($results | Where-Object { -not $_.Pass }).Count -gt 0) {
  exit 2
}

exit 0